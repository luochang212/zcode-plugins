// pick_scene_file：递归列出工作区里的 .blend 文件，供面板选择。跳过依赖与 VCS 目录，限制数量避免大仓库刷屏。
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  ".zcode",
  "dist",
  "build",
  ".cache",
]);

export async function listBlendFiles(root, { limit = 200, maxDepth = 8, fs = { readdir } } = {}) {
  const found = [];
  let truncated = false;
  async function walk(dir, depth) {
    if (truncated || depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // 无权限或已被删除的目录直接跳过
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (truncated) return;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        await walk(join(dir, entry.name), depth + 1);
      } else if (entry.isFile() && /\.blend$/i.test(entry.name)) {
        if (found.length >= limit) {
          truncated = true;
          return;
        }
        found.push(relative(root, join(dir, entry.name)));
      }
    }
  }
  await walk(root, 0);
  return { files: found, truncated };
}
