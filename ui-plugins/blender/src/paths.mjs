// 工作区路径守卫：模型给的路径只允许落在工作区根目录（或显式放行的输出目录）内。
// 这里只做字符串层面的规范化判断，符号链接逃逸由 bridge.py 在打开/写入前再用 realpath 复核。
import { isAbsolute, relative, resolve, sep } from "node:path";

export class PathOutsideWorkspaceError extends Error {
  constructor(path, root) {
    super(`Path is outside the workspace: ${path} (workspace: ${root})`);
    this.name = "PathOutsideWorkspaceError";
    this.code = "path_outside_workspace";
  }
}

function normalizeForCompare(p, platform) {
  return platform === "win32" ? p.toLowerCase() : p;
}

/** 目标是否位于 root 之内（含 root 本身）。 */
export function isInsideRoot(root, target, platform = process.platform) {
  const rel = relative(
    normalizeForCompare(resolve(root), platform),
    normalizeForCompare(resolve(target), platform),
  );
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/**
 * 把模型/面板传来的路径解析成绝对路径；相对路径按 root 解析，越界抛 PathOutsideWorkspaceError。
 * `extraRoots` 用于放行插件数据目录里的渲染/导出产物。
 */
export function resolveInsideRoots(input, root, extraRoots = [], platform = process.platform) {
  if (typeof input !== "string" || input.trim() === "") {
    throw new TypeError("Path must be a non-empty string");
  }
  const abs = isAbsolute(input) ? resolve(input) : resolve(root, input);
  for (const candidate of [root, ...extraRoots]) {
    if (isInsideRoot(candidate, abs, platform)) return abs;
  }
  throw new PathOutsideWorkspaceError(input, root);
}
