import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await import("./build-ui.mjs");
// 原来只构建面板，server 依赖仓库 node_modules；发布入口内联 MCP/Zod，保留 bridge 的相对路径。
await build({
  entryPoints: [resolve(root, "server.mjs")],
  outfile: resolve(root, "dist/server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  legalComments: "linked",
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require=__createRequire(import.meta.url);',
  },
});
