// Blender 引擎发现与便携版下载。
// 解析顺序：
//   userConfig.blenderPath → 已安装的 App/Program Files/PATH → 插件下载的便携版 → 无（glTF-only）。
// 所有 IO 经 deps 注入，便于在单测里用假 fs/fetch/exec 覆盖三平台分支。
import { execFile as execFileCb } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import * as fsp from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

export const BLENDER_VERSION = "5.2.1";
// 已经通过 https://download.blender.org/release/Blender5.2/ 目录页核对过文件名（2026-09-11）。
// 5.2 系列官方没有 Intel macOS 包，darwin-x64 走不到便携版这一级。
export const RELEASE_BASE_URL = `https://download.blender.org/release/Blender${BLENDER_VERSION.split(".").slice(0, 2).join(".")}/`;
export const PORTABLE_ASSETS = {
  "win32-x64": {
    file: `blender-${BLENDER_VERSION}-windows-x64.zip`,
    kind: "zip",
    approxBytes: 360 * 1024 * 1024,
  },
  "win32-arm64": {
    file: `blender-${BLENDER_VERSION}-windows-arm64.zip`,
    kind: "zip",
    approxBytes: 340 * 1024 * 1024,
  },
  "linux-x64": {
    file: `blender-${BLENDER_VERSION}-linux-x64.tar.xz`,
    kind: "tarxz",
    approxBytes: 350 * 1024 * 1024,
  },
  "darwin-arm64": {
    file: `blender-${BLENDER_VERSION}-macos-arm64.dmg`,
    kind: "dmg",
    approxBytes: 330 * 1024 * 1024,
  },
};
export const PLUGIN_ID = "blender";

const defaultDeps = () => ({
  fs: fsp,
  env: process.env,
  platform: process.platform,
  arch: process.arch,
  homedir,
  exec: promisify(execFileCb),
  fetch: globalThis.fetch,
  createWriteStream,
});

export function portableAsset(platform, arch) {
  return PORTABLE_ASSETS[`${platform}-${arch}`] ?? null;
}

/** 插件数据目录：宿主注入 ZCODE_PLUGIN_DATA；单独跑 server 时退到 ~/.zcode/plugins-data/<id>。 */
export function pluginDataDir(deps = {}) {
  const { env = process.env, homedir: home = homedir } = deps;
  return env.ZCODE_PLUGIN_DATA || join(home(), ".zcode", "plugins-data", PLUGIN_ID);
}

export function engineDownloadDir(config = {}, deps = {}) {
  return config.engineDownloadDir?.trim() || join(pluginDataDir(deps), "engine");
}

/** 便携版解压后可执行文件的位置（按包内目录名推算，安装时 engine.json 也会记录实际路径）。 */
export function portableExecutablePath(dir, platform, arch) {
  const asset = portableAsset(platform, arch);
  if (!asset) return null;
  const folder = basename(asset.file).replace(/\.(zip|tar\.xz|dmg)$/, "");
  if (platform === "darwin") return join(dir, "Blender.app", "Contents", "MacOS", "Blender");
  if (platform === "win32") return join(dir, folder, "blender.exe");
  return join(dir, folder, "blender");
}

export function installedCandidates(platform, env = {}) {
  if (platform === "darwin") {
    return [
      "/Applications/Blender.app/Contents/MacOS/Blender",
      join(env.HOME ?? "", "Applications/Blender.app/Contents/MacOS/Blender"),
    ];
  }
  if (platform === "win32") {
    const roots = [
      env.ProgramFiles ?? "C:\\Program Files",
      env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
    ];
    const out = [];
    for (const root of roots) {
      out.push(
        join(
          root,
          "Blender Foundation",
          `Blender ${BLENDER_VERSION.split(".").slice(0, 2).join(".")}`,
          "blender.exe",
        ),
      );
      out.push(join(root, "Blender Foundation", "Blender", "blender.exe"));
    }
    return out;
  }
  return [
    "/usr/bin/blender",
    "/usr/local/bin/blender",
    "/snap/bin/blender",
    "/opt/blender/blender",
  ];
}

async function exists(fs, p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function findOnPath(deps, name) {
  const { fs, env, platform } = deps;
  const dirs = (env.PATH ?? "").split(platform === "win32" ? ";" : ":").filter(Boolean);
  const names = platform === "win32" ? [`${name}.exe`, name] : [name];
  for (const dir of dirs) {
    for (const n of names) {
      const p = join(dir, n);
      if (await exists(fs, p)) return p;
    }
  }
  return null;
}

/**
 * 解析引擎。返回 { kind: "user"|"installed"|"portable"|"none", path?, version?, portableDir, reason? }。
 * 不在这里探测版本（要起进程），由 probeVersion 按需做。
 */
export async function resolveEngine(config = {}, overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides };
  const { fs, env, platform, arch } = deps;
  const portableDir = engineDownloadDir(config, deps);

  if (config.blenderPath?.trim()) {
    const p = config.blenderPath.trim();
    if (await exists(fs, p)) return { kind: "user", path: p, portableDir };
    return { kind: "none", portableDir, reason: `userConfig.blenderPath 不存在：${p}` };
  }
  for (const candidate of installedCandidates(platform, env)) {
    if (await exists(fs, candidate)) return { kind: "installed", path: candidate, portableDir };
  }
  const onPath = await findOnPath(deps, "blender");
  if (onPath) return { kind: "installed", path: onPath, portableDir };

  const portable = await readPortableManifest(fs, portableDir);
  if (portable?.executable && (await exists(fs, portable.executable))) {
    return { kind: "portable", path: portable.executable, version: portable.version, portableDir };
  }
  const guess = portableExecutablePath(portableDir, platform, arch);
  if (guess && (await exists(fs, guess))) return { kind: "portable", path: guess, portableDir };

  const asset = portableAsset(platform, arch);
  return {
    kind: "none",
    portableDir,
    reason: asset
      ? `未找到 Blender，可下载官方便携版 ${asset.file}（约 ${Math.round(asset.approxBytes / 1024 / 1024)} MB）`
      : `未找到 Blender，且 ${platform}-${arch} 没有官方便携版`,
  };
}

async function readPortableManifest(fs, dir) {
  try {
    return JSON.parse(await fs.readFile(join(dir, "engine.json"), "utf8"));
  } catch {
    return null;
  }
}

/** `blender --version` 第一行形如 "Blender 5.2.1 LTS"。 */
export async function probeVersion(blenderPath, overrides = {}) {
  const { exec } = { ...defaultDeps(), ...overrides };
  try {
    const { stdout } = await exec(blenderPath, ["--version"], { timeout: 30_000 });
    const m = /Blender\s+(\d+\.\d+\.\d+)/.exec(String(stdout));
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export function parseSha256Listing(text, fileName) {
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line.trim());
    if (m && basename(m[2].trim()) === fileName) return m[1].toLowerCase();
  }
  return null;
}

async function downloadToFile(url, dest, { fetch, createWriteStream: cws, signal, onProgress }) {
  const res = await fetch(url, { signal, redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`下载失败 ${res.status} ${url}`);
  const total = Number(res.headers.get("content-length")) || undefined;
  const hash = createHash("sha256");
  let received = 0;
  const source = Readable.fromWeb(res.body, { signal });
  source.on("data", (chunk) => {
    hash.update(chunk);
    received += chunk.length;
    onProgress?.({ phase: "download", bytes: received, total });
  });
  await pipeline(source, cws(dest), { signal });
  return { sha256: hash.digest("hex"), bytes: received };
}

async function extract(asset, archivePath, targetDir, deps) {
  const { exec, fs, platform } = deps;
  if (asset.kind === "tarxz") {
    await exec("tar", ["-xJf", archivePath, "-C", targetDir], { maxBuffer: 1 << 20 });
    return;
  }
  if (asset.kind === "zip") {
    // Windows 10+ 自带 bsdtar（tar.exe）能解 zip；mac 的 bsdtar 同样支持。不引入 zip 依赖。
    await exec(platform === "win32" ? "tar.exe" : "tar", ["-xf", archivePath, "-C", targetDir], {
      maxBuffer: 1 << 20,
    });
    return;
  }
  if (asset.kind === "dmg") {
    const mountPoint = join(targetDir, ".mnt");
    await fs.mkdir(mountPoint, { recursive: true });
    await exec("hdiutil", [
      "attach",
      archivePath,
      "-nobrowse",
      "-readonly",
      "-noautoopen",
      "-mountpoint",
      mountPoint,
    ]);
    try {
      await exec("cp", ["-R", join(mountPoint, "Blender.app"), join(targetDir, "Blender.app")]);
    } finally {
      await exec("hdiutil", ["detach", mountPoint, "-force"]).catch(() => {});
      await fs.rm(mountPoint, { recursive: true, force: true }).catch(() => {});
    }
    return;
  }
  throw new Error(`未知包类型 ${asset.kind}`);
}

/**
 * 下载并安装便携版。onProgress({ phase, bytes, total, message })。
 * 中止或校验失败会清掉临时文件，不留半成品；成功后写 engine.json 记录版本与可执行文件路径。
 */
export async function downloadEngine({ dir, onProgress, signal } = {}, overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides };
  const { fs, platform, arch } = deps;
  const asset = portableAsset(platform, arch);
  if (!asset) throw new Error(`${platform}-${arch} 没有官方便携版 Blender ${BLENDER_VERSION}`);
  const targetDir = dir ?? engineDownloadDir({}, deps);
  const tmpDir = join(targetDir, ".download");
  const archivePath = join(tmpDir, `${asset.file}.part`);
  await fs.mkdir(tmpDir, { recursive: true });
  try {
    onProgress?.({ phase: "checksum", message: "读取官方 sha256 清单" });
    const shaRes = await deps.fetch(`${RELEASE_BASE_URL}blender-${BLENDER_VERSION}.sha256`, {
      signal,
    });
    if (!shaRes.ok) throw new Error(`读取 sha256 清单失败 ${shaRes.status}`);
    const expected = parseSha256Listing(await shaRes.text(), asset.file);
    if (!expected) throw new Error(`sha256 清单里没有 ${asset.file}`);

    const { sha256, bytes } = await downloadToFile(
      `${RELEASE_BASE_URL}${asset.file}`,
      archivePath,
      { ...deps, signal, onProgress },
    );
    if (sha256 !== expected) throw new Error(`sha256 不匹配：期望 ${expected}，实际 ${sha256}`);

    onProgress?.({ phase: "extract", bytes, total: bytes, message: "解压中" });
    await extract(asset, archivePath, targetDir, deps);
    const executable = portableExecutablePath(targetDir, platform, arch);
    if (!(await exists(fs, executable)))
      throw new Error(`解压完成但没有找到可执行文件：${executable}`);
    if (platform !== "win32") await fs.chmod(executable, 0o755).catch(() => {});
    await fs.writeFile(
      join(targetDir, "engine.json"),
      JSON.stringify(
        {
          version: BLENDER_VERSION,
          asset: asset.file,
          sha256,
          executable,
          installedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    onProgress?.({ phase: "done", bytes, total: bytes, message: "安装完成" });
    return { path: executable, version: BLENDER_VERSION, bytes, dir: targetDir };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export function describeEngine(resolved) {
  if (!resolved || resolved.kind === "none")
    return `无 Blender 引擎（glTF-only）${resolved?.reason ? `：${resolved.reason}` : ""}`;
  const via =
    { user: "用户配置", installed: "已安装", portable: "插件便携版" }[resolved.kind] ??
    resolved.kind;
  return `Blender ${resolved.version ?? ""} (${via}) ${resolved.path}`.replace(/\s+/g, " ");
}
