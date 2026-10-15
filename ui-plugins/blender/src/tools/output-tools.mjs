// 输出类工具：render_preview / save_scene / export_glb(app) / pick_scene_file(app) / run_python(allowPython)。
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { BridgeError } from "../bridge-client.mjs";
import { resolveInsideRoots } from "../paths.mjs";
import { guarded, okResult, uiMeta } from "./common.mjs";

export const RENDER_TIMEOUT_MS = 600_000;
const MAX_GLB_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_FACES = 200_000;

function newId() {
  return `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

async function fileExists(fs, p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export function registerOutputTools(ctx) {
  const { server } = ctx;

  server.registerTool(
    "render_preview",
    {
      title: "Render preview",
      description:
        "Render the active camera to PNG with EEVEE (falls back to Cycles CPU with fewer samples on failure). Returns a blender://render/<id>.png resource URI. Call after mutations to check the result.",
      inputSchema: {
        width: z.number().int().min(16).max(4096).optional().describe("Default 640"),
        height: z.number().int().min(16).max(4096).optional().describe("Default 480"),
        samples: z.number().int().min(1).max(4096).optional().describe("Default 16"),
        engine: z
          .enum(["eevee", "cycles"])
          .optional()
          .describe(`Default from userConfig.renderEngine (${ctx.config.renderEngine})`),
      },
      _meta: { ...uiMeta(["model", "app"]), timeoutMs: RENDER_TIMEOUT_MS },
    },
    guarded(ctx, async ({ width, height, samples, engine }, extra) => {
      const bridge = await ctx.getBridge();
      const id = newId();
      const path = join(ctx.outputRoot, "renders", `${id}.png`);
      const started = Date.now();
      const render = await bridge.call(
        "render",
        { path, width, height, samples, engine: engine ?? ctx.config.renderEngine },
        { timeoutMs: RENDER_TIMEOUT_MS, signal: extra?.signal },
      );
      const uri = `blender://render/${id}.png`;
      const ms = Date.now() - started;
      return okResult(
        `Rendered ${render.width}x${render.height} with ${render.engineUsed} (${render.samples} samples${render.fallback ? ", fallback" : ""}) in ${ms} ms → ${uri}`,
        {
          render: {
            id,
            uri,
            path: render.path,
            width: render.width,
            height: render.height,
            engineUsed: render.engineUsed,
            samples: render.samples,
            fallback: render.fallback,
            ms,
            revision: bridge.state?.revision ?? null,
          },
        },
        bridge.state,
      );
    }),
  );

  server.registerTool(
    "save_scene",
    {
      title: "Save scene",
      description:
        "Save the open scene in place, or to another .blend path inside the workspace. Asks the user to confirm before overwriting an existing file.",
      inputSchema: {
        path: z.string().optional().describe("Target .blend path; omitted = save in place"),
      },
    },
    guarded(ctx, async ({ path }, extra) => {
      const bridge = await ctx.getBridge();
      const target = path ? resolveInsideRoots(path, ctx.workspaceRoot) : bridge.state?.file;
      if (target && (await fileExists(ctx.fs, target))) {
        let answer;
        try {
          answer = await server.server.elicitInput(
            {
              message: `${target} 已存在，是否覆盖？`,
              requestedSchema: {
                type: "object",
                properties: { overwrite: { type: "boolean", title: "覆盖已有文件" } },
                required: ["overwrite"],
              },
            },
            { signal: extra?.signal },
          ); // 确认必须随原调用取消，避免超时后留下仍能继续保存的旧请求。
        } catch (error) {
          throw new BridgeError(
            `target exists and the client cannot confirm overwrite (${error.message}); pass a new path`,
            { code: "confirm_unavailable", state: bridge.state },
          );
        }
        if (answer.action !== "accept" || answer.content?.overwrite !== true) {
          return okResult(
            `Save cancelled: user declined to overwrite ${target}`,
            { saved: false, path: target, elicitation: answer.action },
            bridge.state,
          );
        }
      }
      if (extra?.signal?.aborted)
        throw new BridgeError("save cancelled", { code: "aborted", state: bridge.state });
      const saved = await bridge.call("save", path ? { path: target } : {}, {
        signal: extra?.signal,
      });
      return okResult(
        `Saved ${saved.path} (${saved.bytes} bytes)`,
        { saved: true, ...saved },
        bridge.state,
      );
    }),
  );

  server.registerTool(
    "export_glb",
    {
      title: "Export GLB (panel)",
      description:
        "App-only: export the visible scene to GLB for the Three.js panel. No Draco by default (the sandbox has no decoder); decimates when the face budget is exceeded and retries once with half the budget when the file is over 8 MiB.",
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe(
            "Target path inside the workspace; default <plugin-data>/output/exports/<id>.glb",
          ),
        draco: z
          .boolean()
          .optional()
          .describe("Default false: the browser panel cannot decode Draco"),
        maxFaces: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Face budget before temporary decimation; default 200000"),
      },
      _meta: uiMeta(["app"]),
    },
    guarded(ctx, async ({ path, draco, maxFaces }, extra) => {
      const bridge = await ctx.getBridge();
      const id = newId();
      const target = path
        ? resolveInsideRoots(path, ctx.workspaceRoot, [ctx.outputRoot])
        : join(ctx.outputRoot, "exports", `${id}.glb`);
      const options = { timeoutMs: RENDER_TIMEOUT_MS, signal: extra?.signal };
      let budget = maxFaces ?? DEFAULT_MAX_FACES;
      let exported = await bridge.call(
        "export_glb",
        { path: target, draco: draco ?? false, maxFaces: budget },
        options,
      );
      let retried = false;
      if (exported.bytes > MAX_GLB_BYTES) {
        // 超出面板 8 MiB 预算：把面数预算减半（以实际面数为上限）重导一次；仍超限就明确报错，不让面板读一个必失败的资源。
        budget = Math.max(1, Math.floor(Math.min(budget, exported.faces || budget) / 2));
        exported = await bridge.call(
          "export_glb",
          { path: target, draco: draco ?? false, maxFaces: budget },
          options,
        );
        retried = true;
      }
      if (exported.bytes > MAX_GLB_BYTES) {
        throw new BridgeError(
          `GLB is ${exported.bytes} bytes after decimating to ${budget} faces; the panel budget is ${MAX_GLB_BYTES} bytes`,
          {
            code: "export_too_large",
            state: bridge.state,
            details: {
              bytes: exported.bytes,
              limit: MAX_GLB_BYTES,
              faces: exported.faces,
              maxFaces: budget,
            },
          },
        );
      }
      const uri = path ? null : `blender://export/${id}.glb`;
      return okResult(
        `Exported GLB ${exported.bytes} bytes (${exported.faces} faces${exported.decimateRatio < 1 ? `, decimated ×${exported.decimateRatio.toFixed(3)}` : ""}${retried ? ", retried with half budget" : ""})`,
        { glb: { id, uri, ...exported, oversized: false, retried } },
        bridge.state,
      );
    }),
  );

  server.registerTool(
    "pick_scene_file",
    {
      title: "List .blend files (panel)",
      description:
        "App-only: list .blend files inside the workspace (recursive, skips node_modules/.git) so the panel can offer a picker.",
      inputSchema: { limit: z.number().int().min(1).max(1000).optional() },
      _meta: uiMeta(["app"]),
    },
    guarded(ctx, async ({ limit }) => {
      const result = await ctx.listBlendFiles(ctx.workspaceRoot, { limit: limit ?? 200 });
      return okResult(
        `${result.files.length} .blend files${result.truncated ? " (truncated)" : ""}`,
        { ...result, workspaceRoot: ctx.workspaceRoot },
        ctx.bridgeState(),
      );
    }),
  );

  if (ctx.config.allowPython) {
    server.registerTool(
      "run_python",
      {
        title: "Run Python in Blender",
        description:
          "Escape hatch: run a bpy script inside the Blender engine and return its stdout. Imports of os/subprocess/socket/shutil/importlib/ctypes and file-writing calls are blocked. Any run bumps the revision. Only registered when userConfig.allowPython is true.",
        inputSchema: {
          code: z.string().min(1).max(64_000),
          expectedRevision: z.number().int().optional(),
        },
      },
      guarded(ctx, async ({ code, expectedRevision }, extra) => {
        const bridge = await ctx.getBridge();
        const result = await bridge.call(
          "run_python",
          { code, expectedRevision },
          { timeoutMs: RENDER_TIMEOUT_MS, signal: extra?.signal },
        );
        return okResult(
          result.stdout ? `stdout:\n${result.stdout}` : "(no output)",
          { python: result },
          bridge.state,
        );
      }),
    );
  }
}
