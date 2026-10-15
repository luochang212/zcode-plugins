/**
 * Blender 插件对外合同：面板、Skill、宿主 e2e 共享的标识、工具表与结果信封。
 * 运行时源码是 .mjs（src/tools/common.mjs、src/tools/engine-tools.mjs、src/engine.mjs），
 * 这里是 TS 侧镜像；src/contract.test.ts 用真实 server 校验两边一致，改常量要同时改两处。
 */
export const PLUGIN_ID = "blender";
/** plugin.json 的 mcpServers 键，也是 ui.surfaces[].server。 */
export const SERVER_NAME = "blender";
export const SURFACE_ID = "blender";
export const PANEL_URI = "ui://blender/panel.html";
export const HTML_MIME = "text/html;profile=mcp-app";
export const RENDER_URI_TEMPLATE = "blender://render/{id}.png";
export const EXPORT_URI_TEMPLATE = "blender://export/{id}.glb";
/** 单次 GLB 导出上限：超出先把面数减半重试一次，仍超出返回 export_too_large。 */
export const MAX_GLB_BYTES = 8 * 1024 * 1024;
export const ENSURE_ENGINE_TIMEOUT_MS = 900_000;

/** 无论配置如何都注册的工具。 */
export const CORE_TOOLS = [
  "add_object",
  "ensure_engine",
  "export_glb",
  "inspect_object",
  "inspect_scene",
  "new_scene",
  "open_scene",
  "pick_scene_file",
  "render_preview",
  "save_scene",
  "set_camera",
  "set_material",
  "set_transform",
  "set_visibility",
] as const;
/** 仅 user_config.allowPython 打开时注册，受审批流约束。 */
export const OPTIONAL_TOOLS = ["run_python"] as const;
/** visibility ["app"]：只允许面板回调，不进模型工具表。 */
export const APP_ONLY_TOOLS = ["export_glb", "pick_scene_file"] as const;
/** 带 fullscreen 偏好、结果一到就拉起侧栏面板的工具。 */
export const FULLSCREEN_TOOLS = [
  "ensure_engine", "open_scene", "new_scene", "add_object",
  "inspect_scene", "set_transform", "set_material",
  "set_camera", "set_visibility", "render_preview",
] as const;
export type BlenderToolName = (typeof CORE_TOOLS)[number] | (typeof OPTIONAL_TOOLS)[number];

/** 工具层 errorResult 的 code；桥内错误（closed / timeout / process_*）也走同一信封。 */
export const ERROR_CODES = [
  "revision_conflict",
  "engine_missing",
  "export_too_large",
  "file_exists",
  "path_outside_workspace",
  "invalid_args",
  "no_camera",
  "object_not_found",
  "confirm_unavailable",
] as const;
export type ToolErrorCode = (typeof ERROR_CODES)[number];

/** 桥缓存的场景状态。每个工具结果的 structuredContent.state 都带它；变更工具必须回传 revision。 */
export interface SceneState {
  file: string | null;
  revision: number;
  selected: string[];
  camera: { name: string } | null;
  engine: { render: string; version: string };
}
export interface ToolError {
  code: ToolErrorCode | string;
  message: string;
  details?: Record<string, unknown>;
}
/** 所有工具结果的 structuredContent 形状；isError 时带 error，state 仍给当前 revision 让模型重读。 */
export interface ToolStructuredContent {
  state: SceneState | null;
  error?: ToolError;
  [key: string]: unknown;
}
