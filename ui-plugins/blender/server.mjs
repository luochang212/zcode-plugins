#!/usr/bin/env node
// ZCode Blender 插件 MCP 服务。
// 宿主用 `node server.mjs` 起 stdio 进程，env 由 .zcode-plugin/plugin.json 从 user_config 注入。
import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { configFromEnv, createBlenderServer } from "./src/server-factory.mjs";

const workspaceRoot = resolve(
  process.env.ZCODE_WORKSPACE_ROOT || process.env.ZCODE_PROJECT_DIR || process.cwd(),
);
const { server, close } = createBlenderServer({
  config: configFromEnv(process.env),
  workspaceRoot,
  log: (level, message) => {
    if (level !== "debug" || process.env.ZCODE_BLENDER_DEBUG)
      process.stderr.write(`[blender:${level}] ${message}\n`);
  },
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    close().finally(() => process.exit(0));
  });
}
process.stdin.on("close", () => {
  close().finally(() => process.exit(0));
});

await server.connect(new StdioServerTransport());
