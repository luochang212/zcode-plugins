// 创建类工具：new_scene / add_object。补上"从零开始"的能力：没有 .blend 时先 new_scene，再用 add_object 搭场景。
// 与 scene-tools 共用 expectedRevision 语义（common.mjs mutate）。
import { z } from "zod";
import { BridgeError } from "../bridge-client.mjs";
import { resolveInsideRoots } from "../paths.mjs";
import { guarded, mutate, okResult, summarizeScene, uiMeta } from "./common.mjs";
import { color, expectedRevision, vec3 } from "./scene-tools.mjs";

export const OBJECT_TYPES = [
  "cube",
  "sphere",
  "plane",
  "cylinder",
  "cone",
  "torus",
  "light",
  "camera",
  "empty",
];
export const LIGHT_TYPES = ["POINT", "SUN", "SPOT", "AREA"];

export function registerCreateTools(ctx) {
  const { server } = ctx;

  server.registerTool(
    "new_scene",
    {
      title: "New .blend scene",
      description:
        "Create a new scene and save it as a .blend inside the workspace, then open it (revision 0). Use this when the user wants to build something from scratch and no .blend exists yet. template 'basic' adds a camera and a sun light; 'empty' has nothing. Refuses to replace an existing file unless overwrite is true. Opens the Blender side panel.",
      inputSchema: {
        path: z
          .string()
          .describe(
            "Where to save the new .blend, absolute or relative to the workspace root (must end with .blend)",
          ),
        template: z
          .enum(["empty", "basic"])
          .optional()
          .describe("Default 'basic': camera + sun light aimed at the origin"),
        overwrite: z
          .boolean()
          .optional()
          .describe("Replace the file if it already exists (default false)"),
      },
      _meta: uiMeta(["model", "app"]),
    },
    guarded(ctx, async ({ path, template, overwrite }, extra) => {
      const abs = resolveInsideRoots(path, ctx.workspaceRoot);
      if (!abs.toLowerCase().endsWith(".blend"))
        throw new BridgeError("path must end with .blend", {
          code: "invalid_args",
          state: ctx.bridgeState(),
        });
      if (!overwrite && (await exists(ctx.fs, abs))) {
        throw new BridgeError(`file already exists: ${abs} (pass overwrite: true to replace it)`, {
          code: "file_exists",
          state: ctx.bridgeState(),
        });
      }
      const bridge = await ctx.getBridge();
      const scene = await bridge.call(
        "new_scene",
        { path: abs, template: template ?? "basic", overwrite: Boolean(overwrite) },
        { signal: extra?.signal },
      );
      return okResult(`Created ${summarizeScene(scene)}`, { scene }, bridge.state);
    }),
  );

  server.registerTool(
    "add_object",
    {
      title: "Add object",
      description:
        "Add one object to the open scene: a mesh primitive (cube, sphere, plane, cylinder, cone, torus), a light, a camera or an empty. Mesh primitives accept size (edge length / diameter in metres) and baseColor (creates a Principled BSDF material). Lights take light.type/energy/color; cameras take lens and become active when the scene has no camera. Names are made unique (Cube, Cube.001, …). Follow up with set_transform / set_material for finer control, and render_preview to check the result.",
      inputSchema: {
        type: z.enum(OBJECT_TYPES),
        name: z.string().optional().describe("Object name; default is the capitalised type"),
        location: vec3.optional(),
        rotation: vec3.optional().describe("Degrees, XYZ Euler"),
        scale: z.union([vec3, z.number()]).optional(),
        size: z
          .number()
          .positive()
          .optional()
          .describe(
            "Mesh primitives only: edge length (cube/plane) or diameter (sphere/cylinder/cone/torus), default 2",
          ),
        baseColor: color.optional().describe("Mesh primitives only: RGB or RGBA in 0..1"),
        light: z
          .object({
            type: z.enum(LIGHT_TYPES).optional(),
            energy: z.number().min(0).optional().describe("Watts"),
            color: color.optional(),
          })
          .optional()
          .describe("type light only"),
        lens: z.number().positive().optional().describe("type camera only: focal length in mm"),
        makeActive: z
          .boolean()
          .optional()
          .describe("type camera only: make it the render camera even if one exists"),
        expectedRevision,
      },
      _meta: uiMeta(["model", "app"]),
    },
    guarded(ctx, async (args, extra) => {
      const object = await mutate(ctx, "add_object", args, extra);
      return okResult(
        `Added ${object.name} (${object.type}) at ${JSON.stringify(object.location)}, dims ${JSON.stringify(object.dimensions)}`,
        { object },
        ctx.bridgeState(),
      );
    }),
  );
}

async function exists(fs, path) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}
