import type { SceneState, ToolStructuredContent } from "./contract";
export const sceneStateExample: SceneState = {
  file: "scenes/a.blend",
  revision: 3,
  selected: ["Cube"],
  camera: { name: "Camera" },
  engine: { render: "BLENDER_EEVEE", version: "5.2.1" },
};
/** 过期 expectedRevision 的回包：不碰 Blender，state 里带当前 revision。 */
export const conflictExample: ToolStructuredContent = {
  state: sceneStateExample,
  error: {
    code: "revision_conflict",
    message: "revision mismatch: expected 2, current 3",
    details: { expectedRevision: 2, currentRevision: 3 },
  },
};
