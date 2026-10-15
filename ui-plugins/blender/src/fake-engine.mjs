// 假引擎（ZCODE_BLENDER_FAKE_ENGINE=1）：不启动 Blender，用内存场景实现 bridge.py 的命令集与响应形状，
// 让 CI / e2e 在没有引擎的机器上跑通工具协议与面板数据流。变更命令真的改内存状态并递增 revision。
import * as fsp from "node:fs/promises";
import { dirname } from "node:path";
import { BridgeError } from "./bridge-client.mjs";
import { buildCubeGlb, PNG_1X1 } from "./fake-assets.mjs";
// re-export 不会创建本地绑定；状态回包仍需显式导入版本，才能返回真实的 revision 冲突。
import {
  BASE_OBJECT,
  MESH_TYPES,
  initialScene,
  templateScene,
  FAKE_ENGINE_VERSION,
} from "./fake-scene.mjs";

// 引擎桩（resolveEngine / downloadEngine / probeVersion）与场景数据在 fake-scene.mjs，这里只保留桥。
export { FAKE_ENGINE_PATH, FAKE_ENGINE_VERSION, createFakeEngine } from "./fake-scene.mjs";

export function createFakeBridge({ workspaceRoot, outputRoot, fs = fsp } = {}) {
  let scene = initialScene();
  let file = null;
  let revision = 0;
  let closed = false;

  const get = (name) => {
    const obj = scene.objects.get(name);
    if (!obj)
      throw new BridgeError(`object not found: ${name}`, {
        code: "object_not_found",
        state: state(),
      });
    return obj;
  };
  const cameraState = () => {
    const cam = scene.activeCamera ? scene.objects.get(scene.activeCamera) : null;
    return cam
      ? {
          name: cam.name,
          location: cam.location,
          rotation: cam.rotation,
          lens: cam.camera?.lens ?? null,
        }
      : null;
  };
  const state = () => ({
    file,
    revision,
    selected: [],
    camera: cameraState(),
    engine: { render: scene.renderEngine, version: FAKE_ENGINE_VERSION },
  });
  const checkRevision = (args) => {
    if (
      args.expectedRevision !== undefined &&
      args.expectedRevision !== null &&
      Number(args.expectedRevision) !== revision
    ) {
      throw new BridgeError(
        `revision mismatch: expected ${args.expectedRevision}, current ${revision}`,
        {
          code: "revision_conflict",
          state: state(),
          details: { expectedRevision: args.expectedRevision, currentRevision: revision },
        },
      );
    }
  };
  const bump = () => {
    revision += 1;
  };
  const summary = (obj) => ({ ...obj, materials: [...obj.materials] });
  const inspect = () => {
    const objects = [...scene.objects.values()].map(summary);
    return {
      file,
      sceneName: "Scene",
      objects,
      materials: [...scene.materials.values()].map((m) => ({ ...m })),
      cameras: objects.filter((o) => o.type === "CAMERA").map((o) => o.name),
      activeCamera: scene.activeCamera,
      lights: objects.filter((o) => o.type === "LIGHT").map((o) => o.name),
      render: { engine: scene.renderEngine, resolution: [640, 480], frame: 1 },
      counts: { objects: objects.length, meshes: objects.filter((o) => o.type === "MESH").length },
      blender: FAKE_ENGINE_VERSION,
    };
  };
  async function writeArtifact(path, bytes) {
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, bytes);
    return bytes.length;
  }

  const uniqueName = (base) => {
    if (!scene.objects.has(base)) return base;
    let index = 1;
    while (scene.objects.has(`${base}.${String(index).padStart(3, "0")}`)) index += 1;
    return `${base}.${String(index).padStart(3, "0")}`;
  };

  const commands = {
    ping: async () => ({ pong: true, blender: FAKE_ENGINE_VERSION }),
    new_scene: async (args) => {
      if (
        !String(args.path ?? "")
          .toLowerCase()
          .endsWith(".blend")
      )
        throw new BridgeError("path must end with .blend", {
          code: "invalid_args",
          state: state(),
        });
      const existing = await fs.access(args.path).then(
        () => true,
        () => false,
      );
      if (existing && !args.overwrite)
        throw new BridgeError(`file already exists: ${args.path}`, {
          code: "file_exists",
          state: state(),
        });
      scene = templateScene(args.template ?? "basic");
      revision = 0;
      await writeArtifact(args.path, Buffer.from(`BLENDER-FAKE new ${args.template ?? "basic"}\n`));
      file = args.path;
      return inspect();
    },
    add_object: async (args) => {
      checkRevision(args);
      const kind = String(args.type ?? "").toLowerCase();
      const name = uniqueName(
        String(args.name || (kind ? kind[0].toUpperCase() + kind.slice(1) : "Object")),
      );
      const size = Number(args.size ?? 2);
      let obj;
      if (MESH_TYPES.has(kind)) {
        obj = {
          ...BASE_OBJECT,
          name,
          type: "MESH",
          location: [0, 0, 0],
          dimensions: [size, size, kind === "plane" ? 0 : size],
          materials: [],
          vertices: 8,
          faces: 12,
        };
        if (args.baseColor) {
          const materialName = `${name}_Material`;
          scene.materials.set(materialName, {
            name: materialName,
            users: 1,
            principled: true,
            baseColor: args.baseColor.length === 3 ? [...args.baseColor, 1] : [...args.baseColor],
            metallic: 0,
            roughness: 0.5,
            emissionColor: [0, 0, 0, 1],
            emissionStrength: 0,
          });
          obj.materials = [materialName];
        }
      } else if (kind === "light") {
        const spec = args.light ?? {};
        obj = {
          ...BASE_OBJECT,
          name,
          type: "LIGHT",
          location: [0, 0, 0],
          dimensions: [0, 0, 0],
          light: {
            type: String(spec.type ?? "POINT").toUpperCase(),
            energy: Number(spec.energy ?? 1000),
            color: spec.color ? [...spec.color.slice(0, 3)] : [1, 1, 1],
          },
        };
      } else if (kind === "camera") {
        const active = !scene.activeCamera || Boolean(args.makeActive);
        obj = {
          ...BASE_OBJECT,
          name,
          type: "CAMERA",
          location: [0, 0, 0],
          dimensions: [0, 0, 0],
          camera: { lens: Number(args.lens ?? 50), active },
        };
        if (active) scene.activeCamera = name;
      } else if (kind === "empty") {
        obj = { ...BASE_OBJECT, name, type: "EMPTY", location: [0, 0, 0], dimensions: [0, 0, 0] };
      } else {
        throw new BridgeError(`unknown object type: ${kind}`, {
          code: "invalid_args",
          state: state(),
        });
      }
      if (args.location) obj.location = [...args.location];
      if (args.rotation) obj.rotation = [...args.rotation];
      if (args.scale !== undefined && args.scale !== null)
        obj.scale = Array.isArray(args.scale)
          ? [...args.scale]
          : [args.scale, args.scale, args.scale];
      scene.objects.set(name, obj);
      bump();
      return summary(obj);
    },
    // 假引擎不检查文件是否存在：e2e 不必播种 .blend；路径守卫仍由服务端 resolveInsideRoots 负责。
    open: async (args) => {
      scene = initialScene();
      file = args.path;
      revision = 0;
      return inspect();
    },
    inspect_scene: async () => inspect(),
    list_objects: async (args) => {
      const flt = String(args.filter ?? "")
        .trim()
        .toLowerCase();
      return {
        objects: [...scene.objects.values()]
          .filter((o) => !flt || o.name.toLowerCase().includes(flt) || o.type.toLowerCase() === flt)
          .map((o) => ({ name: o.name, type: o.type, parent: o.parent })),
      };
    },
    inspect_object: async (args) => {
      const obj = get(args.name);
      return {
        ...summary(obj),
        children: [],
        modifiers: [],
        materialDetails: obj.materials.map((m) => ({ ...scene.materials.get(m) })),
        customProperties: {},
        matrixWorld: [
          [1, 0, 0, obj.location[0]],
          [0, 1, 0, obj.location[1]],
          [0, 0, 1, obj.location[2]],
          [0, 0, 0, 1],
        ],
      };
    },
    set_transform: async (args) => {
      checkRevision(args);
      const obj = get(args.name);
      if (args.location) obj.location = [...args.location];
      if (args.rotation) obj.rotation = [...args.rotation];
      if (args.scale !== undefined && args.scale !== null)
        obj.scale = Array.isArray(args.scale)
          ? [...args.scale]
          : [args.scale, args.scale, args.scale];
      bump();
      return summary(obj);
    },
    set_material: async (args) => {
      checkRevision(args);
      const obj = get(args.name);
      const slot = Number(args.slot ?? 0);
      if (slot > Math.max(0, obj.materials.length - 1) && slot !== 0)
        throw new BridgeError(`material slot ${slot} out of range`, {
          code: "invalid_args",
          state: state(),
        });
      let name = obj.materials[slot];
      if (!name) {
        name = `${obj.name}_Material`;
        scene.materials.set(name, {
          name,
          users: 1,
          principled: true,
          baseColor: [0.8, 0.8, 0.8, 1],
          metallic: 0,
          roughness: 0.5,
          emissionColor: [0, 0, 0, 1],
          emissionStrength: 0,
        });
        obj.materials[slot] = name;
      }
      const material = scene.materials.get(name);
      const rgba = (c) => (c.length === 3 ? [...c, 1] : [...c]);
      if (args.baseColor) material.baseColor = rgba(args.baseColor);
      if (args.metallic !== undefined && args.metallic !== null)
        material.metallic = Number(args.metallic);
      if (args.roughness !== undefined && args.roughness !== null)
        material.roughness = Number(args.roughness);
      if (args.emissionColor) material.emissionColor = rgba(args.emissionColor);
      if (args.emissionStrength !== undefined && args.emissionStrength !== null)
        material.emissionStrength = Number(args.emissionStrength);
      bump();
      return { ...material };
    },
    set_camera: async (args) => {
      checkRevision(args);
      const cam = args.name ? get(args.name) : scene.objects.get(scene.activeCamera);
      if (!cam) throw new BridgeError("no camera", { code: "no_camera", state: state() });
      if (cam.type !== "CAMERA")
        throw new BridgeError(`${cam.name} is not a camera`, {
          code: "invalid_args",
          state: state(),
        });
      scene.activeCamera = cam.name;
      if (args.location) cam.location = [...args.location];
      if (args.rotation) cam.rotation = [...args.rotation];
      if (args.lookAt) {
        const target = get(args.lookAt);
        const [dx, dy, dz] = target.location.map((v, i) => v - cam.location[i]);
        const yaw = (Math.atan2(dy, dx) * 180) / Math.PI;
        const pitch = (Math.atan2(Math.hypot(dx, dy), -dz) * 180) / Math.PI;
        cam.rotation = [Math.round(pitch * 1000) / 1000, 0, Math.round((yaw + 90) * 1000) / 1000];
      }
      if (args.lens !== undefined && args.lens !== null)
        cam.camera = { ...(cam.camera ?? { active: true }), lens: Number(args.lens) };
      bump();
      return cameraState();
    },
    set_visibility: async (args) => {
      checkRevision(args);
      const obj = get(args.name);
      if (args.hidden !== undefined && args.hidden !== null) obj.hidden = Boolean(args.hidden);
      if (args.hideRender !== undefined && args.hideRender !== null)
        obj.hideRender = Boolean(args.hideRender);
      bump();
      return summary(obj);
    },
    export_glb: async (args) => {
      const visible = [...scene.objects.values()].filter((o) => o.type === "MESH" && !o.hideRender);
      const nodes = visible.map((o) => ({
        name: o.name,
        translation: [o.location[0], o.location[2], -o.location[1]],
        scale: [o.scale[0], o.scale[2], o.scale[1]],
        color: scene.materials.get(o.materials[0])?.baseColor ?? [0.8, 0.8, 0.8, 1],
      }));
      const bytes = await writeArtifact(args.path, buildCubeGlb(nodes));
      return { path: args.path, bytes, draco: false, faces: visible.length * 12, decimateRatio: 1 };
    },
    render: async (args) => {
      if (!scene.activeCamera)
        throw new BridgeError("scene has no active camera; call set_camera first", {
          code: "no_camera",
          state: state(),
        });
      await writeArtifact(args.path, PNG_1X1);
      const engineUsed =
        String(args.engine ?? "eevee").toLowerCase() === "cycles" ? "CYCLES" : scene.renderEngine;
      return {
        path: args.path,
        width: Number(args.width ?? 640),
        height: Number(args.height ?? 480),
        engineUsed,
        samples: Number(args.samples ?? 16),
        fallback: false,
      };
    },
    save: async (args) => {
      const target = args.path ?? file;
      if (!target)
        throw new BridgeError("scene has never been saved; pass a path", {
          code: "no_file",
          state: state(),
        });
      const bytes = await writeArtifact(target, Buffer.from(`BLENDER-FAKE revision ${revision}\n`));
      file = target;
      return { path: target, bytes };
    },
    run_python: async (args) => {
      checkRevision(args);
      if (
        /^\s*(import|from)\s+(os|subprocess|socket|shutil|importlib|ctypes)\b/m.test(
          String(args.code ?? ""),
        )
      ) {
        throw new BridgeError("import of a blocked module is not allowed in run_python", {
          code: "python_blocked_import",
          state: state(),
        });
      }
      bump();
      return {
        stdout: `fake run_python executed ${String(args.code ?? "").split("\n").length} line(s)\n`,
      };
    },
  };

  return {
    async call(cmd, args = {}) {
      if (closed) throw new BridgeError("bridge client is closed", { code: "closed" });
      const handler = commands[cmd];
      if (!handler)
        throw new BridgeError(`unknown command: ${cmd}`, {
          code: "unknown_command",
          state: state(),
        });
      return handler(args);
    },
    get state() {
      return state();
    },
    get lastOpenedFile() {
      return file;
    },
    isRunning: () => !closed,
    async close() {
      closed = true;
    },
    workspaceRoot,
    outputRoot,
  };
}
