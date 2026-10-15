// 工具层共用：_meta.ui 描述、结果/错误封装、进度通知。
import { BridgeError } from "../bridge-client.mjs";
import { PathOutsideWorkspaceError } from "../paths.mjs";

export const PANEL_URI = "ui://blender/panel.html";
export const HTML_MIME = "text/html;profile=mcp-app";
export const SURFACE_ID = "blender";

/**
 * 渲染 UI 的工具统一带这份 _meta.ui。
 * 4a-0 起没有 widgetStateVisibility：widgetState 只存宿主内存，面板要让模型知道的状态走 updateModelContext。
 */
export function uiMeta(visibility, extra = {}) {
  return {
    ui: { resourceUri: PANEL_URI, surface: SURFACE_ID, visibility },
    ...(visibility.includes("model")
      ? { "openai/ui": { preferredModelDisplayMode: "fullscreen" } }
      : {}),
    ...extra,
  };
}

export class EngineMissingError extends Error {
  constructor(reason) {
    super(`Blender engine is not available: ${reason ?? "not found"}. Call ensure_engine first.`);
    this.name = "EngineMissingError";
    this.code = "engine_missing";
  }
}

export function okResult(text, structured = {}, state) {
  return {
    content: [{ type: "text", text }],
    structuredContent: { ...structured, state: state ?? structured.state ?? null },
  };
}

/** 把桥/路径/引擎错误映射成 isError 结果；revision 不匹配也走这里，state 里带当前 revision 让模型重读。 */
export function errorResult(error, state) {
  const code = error?.code ?? "error";
  const message = error instanceof Error ? error.message : String(error);
  const currentState =
    error instanceof BridgeError ? (error.state ?? state ?? null) : (state ?? null);
  const details = error instanceof BridgeError ? error.details : undefined;
  return {
    isError: true,
    content: [{ type: "text", text: `[${code}] ${message}` }],
    structuredContent: {
      error: { code, message, ...(details ? { details } : {}) },
      state: currentState,
    },
  };
}

export function isKnownError(error) {
  return (
    error instanceof BridgeError ||
    error instanceof PathOutsideWorkspaceError ||
    error instanceof EngineMissingError ||
    typeof error?.code === "string"
  );
}

/** 通过 MCP progress token 上报进度；调用方没给 token 时静默。 */
export async function reportProgress(extra, { progress, total, message }) {
  const progressToken = extra?._meta?.progressToken;
  if (progressToken === undefined || typeof extra?.sendNotification !== "function") return;
  try {
    await extra.sendNotification({
      method: "notifications/progress",
      params: { progressToken, progress, total, message },
    });
  } catch {
    /* 通知失败不影响主流程 */
  }
}

/** 统一 try/catch：已知错误转 isError 结果，未知错误继续抛给 SDK。 */
export function guarded(ctx, handler) {
  return async (args, extra) => {
    try {
      return await handler(args, extra);
    } catch (error) {
      if (isKnownError(error)) return errorResult(error, ctx.bridgeState());
      throw error;
    }
  };
}

/**
 * 变更命令统一入口：先用桥缓存的最新 state 快速拒绝过期的 expectedRevision（不打扰 Blender），
 * 桥内 check_revision 再做权威校验。scene-tools 与 create-tools 共用。
 */
export async function mutate(ctx, cmd, args, extra) {
  const known = ctx.bridgeState();
  if (args.expectedRevision !== undefined && known && known.revision !== args.expectedRevision) {
    throw new BridgeError(
      `revision mismatch: expected ${args.expectedRevision}, current ${known.revision}`,
      {
        code: "revision_conflict",
        state: known,
        details: { expectedRevision: args.expectedRevision, currentRevision: known.revision },
      },
    );
  }
  const bridge = await ctx.getBridge();
  return bridge.call(cmd, args, { signal: extra?.signal });
}

export function summarizeScene(scene) {
  const names = scene.objects
    .slice(0, 12)
    .map((o) => `${o.name}(${o.type})`)
    .join(", ");
  const more = scene.objects.length > 12 ? ` …+${scene.objects.length - 12}` : "";
  return `${scene.file ?? "(unsaved scene)"} · ${scene.counts.objects} objects, ${scene.materials.length} materials, camera ${scene.activeCamera ?? "none"}, engine ${scene.render.engine}, Blender ${scene.blender}. Objects: ${names}${more}`;
}
