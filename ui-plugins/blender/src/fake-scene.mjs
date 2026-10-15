// 假引擎的内存场景：初始场景、模板场景与对象骨架，与 fake-engine.mjs 分开只是为了让两个文件都在 400 行内。
export const FAKE_ENGINE_PATH = "fake://blender";
export const FAKE_ENGINE_VERSION = "fake-5.2.1";

/** 与 engine.mjs 同形的模块：resolveEngine / downloadEngine / probeVersion。 */
export function createFakeEngine() {
  return {
    resolveEngine: async () => ({
      kind: "fake",
      path: FAKE_ENGINE_PATH,
      version: FAKE_ENGINE_VERSION,
      portableDir: "",
    }),
    downloadEngine: async () => {
      throw new Error("fake engine does not download");
    },
    probeVersion: async () => FAKE_ENGINE_VERSION,
  };
}

export const BASE_OBJECT = {
  parent: null,
  hidden: false,
  hideRender: false,
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  materials: [],
};
/** new_scene 的模板：empty 什么都没有；basic 一台相机 + 一盏太阳光（与 bridge_create.py 一致）。 */
export function templateScene(template) {
  const objects = new Map();
  if (template === "basic") {
    objects.set("Camera", {
      ...BASE_OBJECT,
      name: "Camera",
      type: "CAMERA",
      location: [7.3589, -6.9258, 4.9583],
      rotation: [63.5593, 0, 46.6919],
      dimensions: [0, 0, 0],
      camera: { lens: 50, active: true },
    });
    objects.set("Light", {
      ...BASE_OBJECT,
      name: "Light",
      type: "LIGHT",
      location: [4.0762, 1.0055, 5.9039],
      rotation: [37.261, 3.16371, 106.936],
      dimensions: [0, 0, 0],
      light: { type: "SUN", energy: 3, color: [1, 1, 1] },
    });
  }
  return {
    objects,
    materials: new Map(),
    activeCamera: template === "basic" ? "Camera" : null,
    renderEngine: "BLENDER_EEVEE_NEXT",
  };
}

export const MESH_TYPES = new Set(["cube", "sphere", "plane", "cylinder", "cone", "torus"]);

export function initialScene() {
  const mesh = (name, location, materials) => ({
    name,
    type: "MESH",
    parent: null,
    hidden: false,
    hideRender: false,
    location,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    dimensions: [2, 2, 2],
    materials,
    vertices: 8,
    faces: 12,
  });
  return {
    objects: new Map([
      ["Cube", mesh("Cube", [0, 0, 1], ["Red"])],
      [
        "Sphere",
        {
          ...mesh("Sphere", [3, 0, 0.6], ["Blue"]),
          scale: [0.6, 0.6, 0.6],
          dimensions: [1.2, 1.2, 1.2],
        },
      ],
      [
        "Plane",
        { ...mesh("Plane", [0, 0, 0], ["Grey"]), scale: [4, 4, 0.02], dimensions: [8, 8, 0.04] },
      ],
      [
        "Camera",
        {
          name: "Camera",
          type: "CAMERA",
          parent: null,
          hidden: false,
          hideRender: false,
          location: [7.4, -6.5, 5.3],
          rotation: [63.6, 0, 46.7],
          scale: [1, 1, 1],
          dimensions: [0, 0, 0],
          materials: [],
          camera: { lens: 50, active: true },
        },
      ],
      [
        "Light",
        {
          name: "Light",
          type: "LIGHT",
          parent: null,
          hidden: false,
          hideRender: false,
          location: [4, 1, 6],
          rotation: [37, 3, 107],
          scale: [1, 1, 1],
          dimensions: [0, 0, 0],
          materials: [],
          light: { type: "POINT", energy: 1000, color: [1, 1, 1] },
        },
      ],
    ]),
    materials: new Map([
      [
        "Red",
        {
          name: "Red",
          users: 1,
          principled: true,
          baseColor: [0.8, 0.2, 0.2, 1],
          metallic: 0,
          roughness: 0.5,
          emissionColor: [0, 0, 0, 1],
          emissionStrength: 0,
        },
      ],
      [
        "Blue",
        {
          name: "Blue",
          users: 1,
          principled: true,
          baseColor: [0.2, 0.5, 0.9, 1],
          metallic: 0,
          roughness: 0.5,
          emissionColor: [0, 0, 0, 1],
          emissionStrength: 0,
        },
      ],
      [
        "Grey",
        {
          name: "Grey",
          users: 1,
          principled: true,
          baseColor: [0.6, 0.6, 0.6, 1],
          metallic: 0,
          roughness: 0.8,
          emissionColor: [0, 0, 0, 1],
          emissionStrength: 0,
        },
      ],
    ]),
    activeCamera: "Camera",
    renderEngine: "BLENDER_EEVEE_NEXT",
  };
}
