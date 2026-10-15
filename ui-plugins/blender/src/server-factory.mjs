// 组装 MCP server：配置、引擎解析、桥注册表、工具与资源。server.mjs 只负责读 env 并接 stdio；
// 单测用 InMemoryTransport 直接调 createBlenderServer 注入假桥/假引擎。
import * as fsp from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createBridgeClient, createBridgeRegistry } from "./bridge-client.mjs";
import {
  downloadEngine,
  engineDownloadDir,
  pluginDataDir,
  probeVersion,
  resolveEngine,
} from "./engine.mjs";
import { createFakeBridge, createFakeEngine } from "./fake-engine.mjs";
import { listBlendFiles } from "./scene-files.mjs";
import { EngineMissingError } from "./tools/common.mjs";
import { registerCreateTools } from "./tools/create-tools.mjs";
import { registerEngineTools } from "./tools/engine-tools.mjs";
import { registerOutputTools } from "./tools/output-tools.mjs";
import { registerSceneTools } from "./tools/scene-tools.mjs";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function configFromEnv(env = process.env) {
  const engine = (env.ZCODE_BLENDER_RENDER_ENGINE || "eevee").trim().toLowerCase();
  return {
    blenderPath: (env.ZCODE_BLENDER_PATH || "").trim(),
    allowPython: /^(1|true|yes)$/i.test((env.ZCODE_BLENDER_ALLOW_PYTHON || "").trim()),
    renderEngine: engine === "cycles" ? "cycles" : "eevee",
    engineDownloadDir: (env.ZCODE_BLENDER_ENGINE_DOWNLOAD_DIR || "").trim(),
    // CI / e2e：不起 Blender，用 src/fake-engine.mjs 的内存场景替代引擎与桥。
    fakeEngine: /^(1|true|yes)$/i.test((env.ZCODE_BLENDER_FAKE_ENGINE || "").trim()),
  };
}

export function createBlenderServer({
  config,
  workspaceRoot,
  outputRoot,
  // 面板资源：优先 esbuild 打好的单文件，缺失（未构建）时退回占位页。
  panelHtmlPaths = [
    join(PLUGIN_ROOT, "ui", "dist", "panel.html"),
    join(PLUGIN_ROOT, "ui", "index.html"),
  ],
  engine = { resolveEngine, downloadEngine, probeVersion },
  engineDeps = {},
  bridgeFactory = createBridgeClient,
  fs = fsp,
  listBlendFiles: listFiles = listBlendFiles,
  platform = process.platform,
  arch = process.arch,
  log = () => {},
}) {
  if (!workspaceRoot) throw new Error("createBlenderServer requires workspaceRoot");
  if (config.fakeEngine) {
    engine = createFakeEngine();
    bridgeFactory = createFakeBridge;
    log(
      "info",
      "ZCODE_BLENDER_FAKE_ENGINE=1: using the in-memory fake engine, Blender will not be started",
    );
  }
  const server = new McpServer(
    { name: "blender", version: "0.2.3" },
    { capabilities: { tools: {}, resources: {} } },
  );
  const registry = createBridgeRegistry(bridgeFactory);
  const resolvedOutputRoot = outputRoot ?? join(pluginDataDir(engineDeps), "output");

  const ctx = {
    server,
    config,
    workspaceRoot,
    outputRoot: resolvedOutputRoot,
    panelHtmlPaths,
    engine,
    engineDeps,
    engineState: { resolved: null, version: null },
    fs,
    listBlendFiles: listFiles,
    platform,
    arch,
    log,
    engineDir: () => engineDownloadDir(config, engineDeps),
    bridgeState: () => registry.peek(workspaceRoot)?.state ?? null,
    async refreshEngine() {
      const resolved = await engine.resolveEngine(config, engineDeps);
      ctx.engineState.resolved = resolved;
      return resolved;
    },
    /** 拿到当前工作区的桥；引擎缺失抛 EngineMissingError（工具层转 isError）。 */
    async getBridge() {
      const resolved = ctx.engineState.resolved ?? (await ctx.refreshEngine());
      if (resolved.kind === "none" || !resolved.path) throw new EngineMissingError(resolved.reason);
      return registry.get(workspaceRoot, {
        blenderPath: resolved.path,
        outputRoot: resolvedOutputRoot,
        onLog: log,
      });
    },
  };

  registerEngineTools(ctx);
  registerSceneTools(ctx);
  registerCreateTools(ctx);
  registerOutputTools(ctx);

  return {
    server,
    ctx,
    async close() {
      await registry.closeAll();
      await server.close();
    },
  };
}
