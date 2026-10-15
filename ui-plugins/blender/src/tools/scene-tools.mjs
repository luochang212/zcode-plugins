// 场景检视与编辑工具：open_scene / inspect_scene / inspect_object / set_transform / set_material / set_camera / set_visibility。
// 编辑工具带可选 expectedRevision：先用桥缓存的最新 state 快速拒绝，桥内再做权威校验（bridge.py check_revision）。
import { z } from "zod";
import { resolveInsideRoots } from "../paths.mjs";
import { guarded, mutate as mutateWith, okResult, summarizeScene, uiMeta } from "./common.mjs";

// tuple 经 MCP SDK 导出为数组形式的 items，部分模型端点会拒绝；固定长度数组保留三维向量校验并输出通用 schema。
export const vec3 = z.array(z.number()).length(3);
export const color = z.array(z.number().min(0).max(1)).min(3).max(4);
export const expectedRevision = z
  .number()
  .int()
  .optional()
  .describe(
    "Reject when the scene revision differs (concurrent edit guard). Take it from the last state.revision you saw.",
  );

const MODEL_APP = uiMeta(["model", "app"]);

export function registerSceneTools(ctx) {
  const { server } = ctx;

  const mutate = (cmd, args, extra) => mutateWith(ctx, cmd, args, extra);

  server.registerTool(
    "open_scene",
    {
      title: "Open .blend scene",
      description:
        "Open a .blend file inside the workspace in the Blender engine and return a scene summary (objects, materials, cameras, revision). Opens the Blender side panel.",
      inputSchema: {
        path: z
          .string()
          .describe("Path to a .blend file, absolute or relative to the workspace root"),
      },
      _meta: uiMeta(["model", "app"]),
    },
    guarded(ctx, async ({ path }, extra) => {
      const abs = resolveInsideRoots(path, ctx.workspaceRoot);
      const bridge = await ctx.getBridge();
      const scene = await bridge.call("open", { path: abs }, { signal: extra?.signal });
      return okResult(summarizeScene(scene), { scene }, bridge.state);
    }),
  );

  server.registerTool(
    "inspect_scene",
    {
      title: "Inspect scene",
      description:
        "List objects, materials, cameras, lights, render settings and the current revision of the open scene. Always call this before mutating tools.",
      inputSchema: {},
      _meta: MODEL_APP,
    },
    guarded(ctx, async (_args, extra) => {
      const bridge = await ctx.getBridge();
      const scene = await bridge.call("inspect_scene", {}, { signal: extra?.signal });
      return okResult(summarizeScene(scene), { scene }, bridge.state);
    }),
  );

  server.registerTool(
    "inspect_object",
    {
      title: "Inspect object",
      description:
        "Detailed properties of one object: transform, dimensions, materials (Principled BSDF values), modifiers, children, custom properties.",
      inputSchema: { name: z.string() },
    },
    guarded(ctx, async ({ name }, extra) => {
      const bridge = await ctx.getBridge();
      const object = await bridge.call("inspect_object", { name }, { signal: extra?.signal });
      return okResult(
        `${object.name} (${object.type}) at ${JSON.stringify(object.location)}, dims ${JSON.stringify(object.dimensions)}, materials ${object.materials.join(", ") || "none"}`,
        { object },
        bridge.state,
      );
    }),
  );

  server.registerTool(
    "set_transform",
    {
      title: "Set transform",
      description:
        "Set location / rotation (degrees, XYZ Euler) / scale of an object. Omitted fields are left unchanged.",
      inputSchema: {
        name: z.string(),
        location: vec3.optional(),
        rotation: vec3.optional(),
        scale: z.union([vec3, z.number()]).optional(),
        expectedRevision,
      },
      _meta: MODEL_APP,
    },
    guarded(ctx, async (args, extra) => {
      const object = await mutate("set_transform", args, extra);
      return okResult(
        `Moved ${object.name}: location ${JSON.stringify(object.location)}, rotation ${JSON.stringify(object.rotation)}, scale ${JSON.stringify(object.scale)}`,
        { object },
        ctx.bridgeState(),
      );
    }),
  );

  server.registerTool(
    "set_material",
    {
      title: "Set material",
      description:
        "Set Principled BSDF base color / metallic / roughness / emission on an object's material slot (creates a node material when missing). Only these channels are supported; use run_python for anything else.",
      inputSchema: {
        name: z.string().describe("Object name"),
        slot: z.number().int().min(0).optional().describe("Material slot index, default 0"),
        baseColor: color.optional().describe("RGB or RGBA in 0..1"),
        metallic: z.number().min(0).max(1).optional(),
        roughness: z.number().min(0).max(1).optional(),
        emissionColor: color.optional(),
        emissionStrength: z.number().min(0).optional(),
        expectedRevision,
      },
      _meta: MODEL_APP,
    },
    guarded(ctx, async (args, extra) => {
      const material = await mutate("set_material", args, extra);
      return okResult(
        `Material ${material.name}: baseColor ${JSON.stringify(material.baseColor)}, metallic ${material.metallic}, roughness ${material.roughness}`,
        { material },
        ctx.bridgeState(),
      );
    }),
  );

  server.registerTool(
    "set_camera",
    {
      title: "Set camera",
      description:
        "Make a camera active and/or move it. `lookAt` aims the camera at an object. Creates a camera when the scene has none.",
      inputSchema: {
        name: z
          .string()
          .optional()
          .describe("Camera object name; default: the active scene camera"),
        location: vec3.optional(),
        rotation: vec3.optional().describe("Degrees, XYZ Euler; ignored when lookAt is given"),
        lookAt: z.string().optional().describe("Object name to aim at"),
        lens: z.number().positive().optional().describe("Focal length in mm"),
        expectedRevision,
      },
      _meta: MODEL_APP,
    },
    guarded(ctx, async (args, extra) => {
      const camera = await mutate("set_camera", args, extra);
      return okResult(
        `Camera ${camera.name} at ${JSON.stringify(camera.location)}, rotation ${JSON.stringify(camera.rotation)}, lens ${camera.lens}`,
        { camera },
        ctx.bridgeState(),
      );
    }),
  );

  server.registerTool(
    "set_visibility",
    {
      title: "Set visibility",
      description: "Hide/show an object in the viewport and/or in renders.",
      inputSchema: {
        name: z.string(),
        hidden: z.boolean().optional().describe("Viewport visibility"),
        hideRender: z.boolean().optional().describe("Render visibility"),
        expectedRevision,
      },
      _meta: MODEL_APP,
    },
    guarded(ctx, async (args, extra) => {
      const object = await mutate("set_visibility", args, extra);
      return okResult(
        `${object.name}: hidden=${object.hidden}, hideRender=${object.hideRender}`,
        { object },
        ctx.bridgeState(),
      );
    }),
  );
}
