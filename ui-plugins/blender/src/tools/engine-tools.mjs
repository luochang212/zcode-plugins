// ensure_engine + 面板资源 + 渲染/导出产物资源模板。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BLENDER_VERSION, describeEngine, portableAsset } from "../engine.mjs";
import { HTML_MIME, PANEL_URI, guarded, okResult, reportProgress, uiMeta } from "./common.mjs";

export const ENSURE_ENGINE_TIMEOUT_MS = 900_000;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

async function confirmDownload(ctx, asset) {
  const mb = Math.round(asset.approxBytes / 1024 / 1024);
  try {
    const answer = await ctx.server.server.elicitInput({
      message: `未检测到 Blender。是否下载官方便携版 Blender ${BLENDER_VERSION}（${asset.file}，约 ${mb} MB，sha256 校验）到 ${ctx.engineDir()}？`,
      requestedSchema: {
        type: "object",
        properties: {
          download: {
            type: "boolean",
            title: "下载便携版 Blender",
            description: `约 ${mb} MB，来自 download.blender.org`,
          },
        },
        required: ["download"],
      },
    });
    return answer.action === "accept" && answer.content?.download === true;
  } catch {
    return false; // 客户端不支持 elicitation：不下载，返回说明让模型带 download:true 再调
  }
}

export function registerEngineTools(ctx) {
  const { server } = ctx;

  server.registerTool(
    "ensure_engine",
    {
      title: "Ensure Blender engine",
      description:
        "Detect the Blender engine (user path → installed app → plugin portable build) and download the official portable build when none exists. Blocks until ready and reports download progress. Call this before any scene tool when the engine status is unknown.",
      inputSchema: {
        download: z
          .boolean()
          .optional()
          .describe(
            "true: download without asking; false: never download, only detect; omitted: ask the user when nothing is found",
          ),
      },
      _meta: { ...uiMeta(["model", "app"]), timeoutMs: ENSURE_ENGINE_TIMEOUT_MS },
    },
    guarded(ctx, async ({ download }, extra) => {
      let resolved = await ctx.refreshEngine();
      if (resolved.kind === "none" && download !== false) {
        const asset = portableAsset(ctx.platform, ctx.arch);
        if (!asset) {
          return okResult(
            describeEngine(resolved),
            { engine: engineInfo(resolved), tier: "gltf-only" },
            ctx.bridgeState(),
          );
        }
        const confirmed = download === true || (await confirmDownload(ctx, asset));
        if (!confirmed) {
          return okResult(
            `${describeEngine(resolved)}。用户未确认下载；如需下载请带 download: true 再调用。`,
            { engine: engineInfo(resolved), tier: "gltf-only", downloadOffered: asset.file },
            ctx.bridgeState(),
          );
        }
        let lastReported = 0;
        await ctx.engine.downloadEngine(
          {
            dir: ctx.engineDir(),
            signal: extra?.signal,
            onProgress: (p) => {
              // 下载回调很密，按 1% 或阶段变化节流后再发 MCP 进度通知。
              const total = p.total ?? asset.approxBytes;
              const pct = p.bytes ? Math.floor((p.bytes / total) * 100) : 0;
              if (p.phase === "download" && pct === lastReported) return;
              lastReported = pct;
              void reportProgress(extra, {
                progress: p.bytes ?? 0,
                total,
                message: p.message ?? `${p.phase} ${pct}%`,
              });
            },
          },
          ctx.engineDeps,
        );
        resolved = await ctx.refreshEngine();
      }
      if (resolved.kind === "none") {
        return okResult(
          describeEngine(resolved),
          { engine: engineInfo(resolved), tier: "gltf-only" },
          ctx.bridgeState(),
        );
      }
      const version =
        resolved.version ?? (await ctx.engine.probeVersion(resolved.path, ctx.engineDeps));
      ctx.engineState.version = version;
      return okResult(
        describeEngine({ ...resolved, version }),
        { engine: engineInfo({ ...resolved, version }), tier: "full" },
        ctx.bridgeState(),
      );
    }),
  );

  server.registerResource(
    "panel",
    PANEL_URI,
    { mimeType: HTML_MIME, description: "Blender panel (Three.js preview, object tree, render)" },
    async () => ({
      contents: [
        { uri: PANEL_URI, mimeType: HTML_MIME, text: await readFirstExisting(ctx.panelHtmlPaths) },
      ],
    }),
  );

  server.registerResource(
    "render",
    new ResourceTemplate("blender://render/{id}.png", { list: undefined }),
    { mimeType: "image/png", description: "Rendered preview image produced by render_preview" },
    async (uri, variables) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "image/png",
          blob: await readArtifact(ctx, "renders", variables.id, ".png"),
        },
      ],
    }),
  );
  server.registerResource(
    "export",
    new ResourceTemplate("blender://export/{id}.glb", { list: undefined }),
    {
      mimeType: "model/gltf-binary",
      description: "GLB exported by export_glb for the panel preview",
    },
    async (uri, variables) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "model/gltf-binary",
          blob: await readArtifact(ctx, "exports", variables.id, ".glb"),
        },
      ],
    }),
  );
}

/** 依次尝试候选路径（ui/dist/panel.html → ui/index.html），全部缺失时抛最后一个错误。 */
async function readFirstExisting(paths) {
  let lastError;
  for (const path of paths) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("no panel html candidates");
}

export function engineInfo(resolved) {
  return {
    kind: resolved.kind,
    path: resolved.path ?? null,
    version: resolved.version ?? null,
    portableDir: resolved.portableDir,
    reason: resolved.reason ?? null,
  };
}

async function readArtifact(ctx, folder, id, ext) {
  const key = Array.isArray(id) ? id[0] : id;
  if (!ID_PATTERN.test(String(key))) throw new Error(`invalid artifact id: ${key}`);
  const buffer = await ctx.fs.readFile(join(ctx.outputRoot, folder, `${key}${ext}`));
  return Buffer.from(buffer).toString("base64");
}
