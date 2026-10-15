#!/usr/bin/env node
// 把 ui/src/main.ts（Three.js 面板）用 esbuild 打成单文件 ui/dist/panel.html：JS/CSS 内联进 ui/template.html。
// 构建器把此产物放入可安装目录；发布前必须构建，安装时不执行编译。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UI = join(ROOT, "ui");

const result = await esbuild.build({
  entryPoints: [join(UI, "src", "main.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  minify: true,
  legalComments: "none",
  write: false,
  logLevel: "warning",
});
const js = result.outputFiles[0].text
  // 内联进 <script> 时不能出现 </script；esbuild 一般不会产出，这里兜底。
  .replace(/<\/script/gi, "<\\/script");
const css = await readFile(join(UI, "src", "panel.css"), "utf8");
const template = await readFile(join(UI, "template.html"), "utf8");
const html = template
  .replace("/*__CSS__*/", () => css.trim())
  .replace("/*__JS__*/", () => js.trim());

await mkdir(join(UI, "dist"), { recursive: true });
await writeFile(join(UI, "dist", "panel.html"), html);
process.stdout.write(`ui/dist/panel.html ${(Buffer.byteLength(html) / 1024).toFixed(0)} KiB\n`);
