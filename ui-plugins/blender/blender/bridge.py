"""ZCode Blender 桥：在 `blender -b --python bridge.py -- --zcode-bridge --workspace <root>` 里运行。

协议：stdin 每行一个请求 {"id", "cmd", "args"}，stdout 每行一个响应 {"id", "ok", "result"|"error", "state"}。
启动完成后先打印 {"event": "ready"}。Blender 自身的输出（版本、渲染进度）不以 "{" 开头，客户端会忽略。

约束：
- 打开/保存只允许工作区根目录内的文件；渲染/导出产物允许落在 --output-root（插件数据目录）。
- 每次修改场景 `REVISION` 加一；所有响应都带 state = {file, revision, selected, camera, engine}。
- run_python 做 AST 级导入守卫：禁 os / subprocess / socket / shutil / importlib / ctypes / builtins，禁 __import__，
  禁 pathlib 风格的写盘方法名。它不是安全沙箱，只是避免最常见的越界，宿主侧仍走审批流。
"""

import ast
import contextlib
import io
import json
import math
import os
import sys
import traceback

import bpy
from mathutils import Vector

# 创建类命令拆在 bridge_create.py；Blender 以 --python 运行本文件时不会把脚本目录加进 sys.path。
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bridge_create  # noqa: E402

REVISION = 0
WORKSPACE_ROOT = None
OUTPUT_ROOT = None
OUT = sys.__stdout__


def emit(payload):
    OUT.write(json.dumps(payload, ensure_ascii=False, default=str) + "\n")
    OUT.flush()


class BridgeError(Exception):
    def __init__(self, message, code="command_failed", details=None):
        super().__init__(message)
        self.code = code
        self.details = details


# ---------------------------------------------------------------------------
# 路径守卫
# ---------------------------------------------------------------------------


def _norm(path):
    real_parent = os.path.realpath(os.path.dirname(os.path.abspath(path)))
    return os.path.join(real_parent, os.path.basename(path))


def _inside(root, path):
    root_real = os.path.realpath(root)
    target = _norm(path)
    if sys.platform == "win32":
        root_real, target = root_real.lower(), target.lower()
    return target == root_real or target.startswith(root_real.rstrip(os.sep) + os.sep)


def guard_path(path, allow_output=False):
    if not isinstance(path, str) or not path.strip():
        raise BridgeError("path must be a non-empty string", "invalid_args")
    abs_path = path if os.path.isabs(path) else os.path.join(WORKSPACE_ROOT, path)
    roots = [WORKSPACE_ROOT] + ([OUTPUT_ROOT] if allow_output and OUTPUT_ROOT else [])
    if not any(_inside(r, abs_path) for r in roots):
        raise BridgeError(f"path is outside the workspace: {path}", "path_outside_workspace")
    return os.path.abspath(abs_path)


# ---------------------------------------------------------------------------
# 状态
# ---------------------------------------------------------------------------


def _deg(euler):
    return [round(math.degrees(v), 4) for v in euler]


def _vec(v):
    return [round(float(x), 5) for x in v]


def camera_state():
    cam = bpy.context.scene.camera
    if not cam:
        return None
    return {
        "name": cam.name,
        "location": _vec(cam.location),
        "rotation": _deg(cam.rotation_euler),
        "lens": round(cam.data.lens, 3) if cam.type == "CAMERA" else None,
    }


def current_state():
    return {
        "file": bpy.data.filepath or None,
        "revision": REVISION,
        "selected": [o.name for o in bpy.context.scene.objects if o.select_get()],
        "camera": camera_state(),
        "engine": {"render": bpy.context.scene.render.engine, "version": bpy.app.version_string},
    }


def bump():
    global REVISION
    REVISION += 1


def check_revision(args):
    expected = args.get("expectedRevision")
    if expected is not None and int(expected) != REVISION:
        raise BridgeError(
            f"revision mismatch: expected {expected}, current {REVISION}",
            "revision_conflict",
            {"expectedRevision": expected, "currentRevision": REVISION},
        )


def get_object(name):
    obj = bpy.data.objects.get(name)
    if obj is None:
        raise BridgeError(f"object not found: {name}", "object_not_found")
    return obj


# ---------------------------------------------------------------------------
# 检视
# ---------------------------------------------------------------------------


def principled_of(material):
    if not material or not material.use_nodes or not material.node_tree:
        return None
    for node in material.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            return node
    return None


def _input(node, *names):
    for name in names:
        sock = node.inputs.get(name)
        if sock is not None:
            return sock
    return None


def material_summary(material):
    node = principled_of(material)
    out = {"name": material.name, "users": material.users, "principled": node is not None}
    if node:
        base = _input(node, "Base Color")
        emission = _input(node, "Emission Color", "Emission")
        out.update(
            {
                "baseColor": _vec(base.default_value) if base else None,
                "metallic": round(_input(node, "Metallic").default_value, 4),
                "roughness": round(_input(node, "Roughness").default_value, 4),
                "emissionColor": _vec(emission.default_value) if emission else None,
                "emissionStrength": round(_input(node, "Emission Strength").default_value, 4)
                if _input(node, "Emission Strength")
                else None,
            }
        )
    return out


def object_summary(obj):
    out = {
        "name": obj.name,
        "type": obj.type,
        "parent": obj.parent.name if obj.parent else None,
        "hidden": obj.hide_get() or obj.hide_viewport,
        "hideRender": obj.hide_render,
        "location": _vec(obj.location),
        "rotation": _deg(obj.rotation_euler),
        "scale": _vec(obj.scale),
        "dimensions": _vec(obj.dimensions),
        "materials": [s.material.name for s in obj.material_slots if s.material],
    }
    if obj.type == "MESH":
        out["vertices"] = len(obj.data.vertices)
        out["faces"] = len(obj.data.polygons)
    if obj.type == "LIGHT":
        out["light"] = {"type": obj.data.type, "energy": obj.data.energy, "color": _vec(obj.data.color)}
    if obj.type == "CAMERA":
        out["camera"] = {"lens": obj.data.lens, "active": bpy.context.scene.camera == obj}
    return out


def cmd_inspect_scene(args):
    scene = bpy.context.scene
    objects = [object_summary(o) for o in scene.objects]
    return {
        "file": bpy.data.filepath or None,
        "sceneName": scene.name,
        "objects": objects,
        "materials": [material_summary(m) for m in bpy.data.materials if not m.is_grease_pencil],
        "cameras": [o.name for o in scene.objects if o.type == "CAMERA"],
        "activeCamera": scene.camera.name if scene.camera else None,
        "lights": [o.name for o in scene.objects if o.type == "LIGHT"],
        "render": {
            "engine": scene.render.engine,
            "resolution": [scene.render.resolution_x, scene.render.resolution_y],
            "frame": scene.frame_current,
        },
        "counts": {"objects": len(objects), "meshes": sum(1 for o in objects if o["type"] == "MESH")},
        "blender": bpy.app.version_string,
    }


def cmd_list_objects(args):
    flt = (args.get("filter") or "").strip().lower()
    out = []
    for o in bpy.context.scene.objects:
        if flt and flt not in o.name.lower() and flt != o.type.lower():
            continue
        out.append({"name": o.name, "type": o.type, "parent": o.parent.name if o.parent else None})
    return {"objects": out}


def cmd_inspect_object(args):
    obj = get_object(args.get("name"))
    out = object_summary(obj)
    out.update(
        {
            "children": [c.name for c in obj.children],
            "modifiers": [{"name": m.name, "type": m.type, "show": m.show_viewport} for m in obj.modifiers],
            "materialDetails": [material_summary(s.material) for s in obj.material_slots if s.material],
            "customProperties": {k: obj[k] for k in obj.keys() if not k.startswith("_")},
            "matrixWorld": [list(row) for row in obj.matrix_world],
        }
    )
    return out


# ---------------------------------------------------------------------------
# 修改
# ---------------------------------------------------------------------------


def cmd_open(args):
    global REVISION
    path = guard_path(args.get("path"))
    if not os.path.isfile(path):
        raise BridgeError(f"file not found: {path}", "file_not_found")
    bpy.ops.wm.open_mainfile(filepath=path, load_ui=False)
    REVISION = 0
    return cmd_inspect_scene({})


def cmd_set_transform(args):
    check_revision(args)
    obj = get_object(args.get("name"))
    if args.get("location") is not None:
        obj.location = Vector(args["location"])
    if args.get("rotation") is not None:
        obj.rotation_euler = [math.radians(v) for v in args["rotation"]]
    if args.get("scale") is not None:
        s = args["scale"]
        obj.scale = Vector(s if isinstance(s, (list, tuple)) else [s, s, s])
    bump()
    bpy.context.view_layer.update()
    return object_summary(obj)


def cmd_set_material(args):
    check_revision(args)
    obj = get_object(args.get("name"))
    slot_index = int(args.get("slot") or 0)
    if not obj.material_slots:
        material = bpy.data.materials.new(name=f"{obj.name}_Material")
        material.use_nodes = True
        obj.data.materials.append(material)
    if slot_index >= len(obj.material_slots):
        raise BridgeError(f"material slot {slot_index} out of range", "invalid_args")
    slot = obj.material_slots[slot_index]
    if slot.material is None:
        slot.material = bpy.data.materials.new(name=f"{obj.name}_Material")
    material = slot.material
    material.use_nodes = True
    node = principled_of(material)
    if node is None:
        node = material.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
        output = next((n for n in material.node_tree.nodes if n.type == "OUTPUT_MATERIAL"), None)
        if output:
            material.node_tree.links.new(node.outputs["BSDF"], output.inputs["Surface"])
    if args.get("baseColor") is not None:
        c = list(args["baseColor"])
        if len(c) == 3:
            c.append(1.0)
        _input(node, "Base Color").default_value = c
    if args.get("metallic") is not None:
        _input(node, "Metallic").default_value = float(args["metallic"])
    if args.get("roughness") is not None:
        _input(node, "Roughness").default_value = float(args["roughness"])
    if args.get("emissionColor") is not None:
        c = list(args["emissionColor"])
        if len(c) == 3:
            c.append(1.0)
        _input(node, "Emission Color", "Emission").default_value = c
    if args.get("emissionStrength") is not None and _input(node, "Emission Strength"):
        _input(node, "Emission Strength").default_value = float(args["emissionStrength"])
    bump()
    return material_summary(material)


def cmd_set_camera(args):
    check_revision(args)
    scene = bpy.context.scene
    cam = get_object(args["name"]) if args.get("name") else scene.camera
    if cam is None:
        cam_data = bpy.data.cameras.new("Camera")
        cam = bpy.data.objects.new("Camera", cam_data)
        scene.collection.objects.link(cam)
    if cam.type != "CAMERA":
        raise BridgeError(f"{cam.name} is not a camera", "invalid_args")
    scene.camera = cam
    if args.get("location") is not None:
        cam.location = Vector(args["location"])
    if args.get("rotation") is not None:
        cam.rotation_euler = [math.radians(v) for v in args["rotation"]]
    if args.get("lookAt"):
        target = get_object(args["lookAt"])
        direction = target.matrix_world.translation - cam.location
        cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    if args.get("lens") is not None:
        cam.data.lens = float(args["lens"])
    bump()
    bpy.context.view_layer.update()
    return camera_state()


def cmd_set_visibility(args):
    check_revision(args)
    obj = get_object(args.get("name"))
    if args.get("hidden") is not None:
        obj.hide_set(bool(args["hidden"]))
        obj.hide_viewport = bool(args["hidden"])
    if args.get("hideRender") is not None:
        obj.hide_render = bool(args["hideRender"])
    bump()
    return object_summary(obj)


# ---------------------------------------------------------------------------
# 输出
# ---------------------------------------------------------------------------


def _eevee_engine_id():
    ids = bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items.keys()
    for candidate in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        if candidate in ids:
            return candidate
    return None


def _set_samples(scene, samples):
    if scene.render.engine == "CYCLES":
        scene.cycles.samples = samples
    else:
        scene.eevee.taa_render_samples = samples


def cmd_render(args):
    scene = bpy.context.scene
    path = guard_path(args.get("path"), allow_output=True)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    width = int(args.get("width") or 640)
    height = int(args.get("height") or 480)
    samples = int(args.get("samples") or 16)
    wanted = (args.get("engine") or "eevee").lower()
    if scene.camera is None:
        raise BridgeError("scene has no active camera; call set_camera first", "no_camera")
    scene.render.resolution_x, scene.render.resolution_y = width, height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = path
    original_engine = scene.render.engine
    attempts = []
    if wanted == "cycles":
        attempts.append(("CYCLES", samples))
    else:
        eevee = _eevee_engine_id()
        if eevee:
            attempts.append((eevee, samples))
        attempts.append(("CYCLES", min(samples, 16)))
    last_error = None
    for engine_id, engine_samples in attempts:
        try:
            scene.render.engine = engine_id
            if engine_id == "CYCLES":
                scene.cycles.device = "CPU"
            _set_samples(scene, engine_samples)
            bpy.ops.render.render(write_still=True)
            if not os.path.isfile(path):
                raise RuntimeError("render finished but no file was written")
            return {"path": path, "width": width, "height": height, "engineUsed": engine_id, "samples": engine_samples, "fallback": engine_id != attempts[0][0]}
        except Exception as error:  # noqa: BLE001 - 渲染失败要退到下一个引擎
            last_error = f"{engine_id}: {error}"
            emit({"event": "log", "message": f"render failed on {last_error}"})
        finally:
            scene.render.engine = original_engine
    raise BridgeError(f"render failed: {last_error}", "render_failed")


def _total_faces(objects):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    total = 0
    for obj in objects:
        try:
            total += len(obj.evaluated_get(depsgraph).data.polygons)
        except (AttributeError, RuntimeError):
            continue
    return total


def cmd_export_glb(args):
    path = guard_path(args.get("path"), allow_output=True)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    draco = bool(args.get("draco", False))  # 面板端没有 Draco 解码器，默认不压
    max_faces = int(args.get("maxFaces") or 0)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH" and not o.hide_render]
    faces = _total_faces(meshes)
    decimated = []
    ratio = 1.0
    if max_faces and faces > max_faces:
        ratio = max_faces / faces
        for obj in meshes:
            mod = obj.modifiers.new("ZCODE_TMP_DECIMATE", "DECIMATE")
            mod.ratio = ratio
            decimated.append((obj, mod))
    try:
        kwargs = {"filepath": path, "export_format": "GLB", "export_apply": True, "use_visible": True, "export_yup": True}
        # 预览不带纹理：沙箱 CSP 不放行 blob: connect-src（GLTFLoader 解内嵌图片会走 fetch），也顺带压体积。
        optional = {"export_draco_mesh_compression_enable": draco, "export_image_format": "NONE"}
        try:
            bpy.ops.export_scene.gltf(**optional, **kwargs)
        except TypeError:
            bpy.ops.export_scene.gltf(**kwargs)  # 该构建不认识某个可选参数
            draco = False
    finally:
        for obj, mod in decimated:
            obj.modifiers.remove(mod)
    return {"path": path, "bytes": os.path.getsize(path), "draco": draco, "faces": faces, "decimateRatio": ratio}


def cmd_save(args):
    path = args.get("path")
    if path:
        target = guard_path(path)
        if not target.lower().endswith(".blend"):
            raise BridgeError("save path must end with .blend", "invalid_args")
        os.makedirs(os.path.dirname(target), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=target, copy=False)
    else:
        if not bpy.data.filepath:
            raise BridgeError("scene has never been saved; pass a path", "no_file")
        guard_path(bpy.data.filepath)
        bpy.ops.wm.save_mainfile()
    return {"path": bpy.data.filepath, "bytes": os.path.getsize(bpy.data.filepath)}


# ---------------------------------------------------------------------------
# run_python
# ---------------------------------------------------------------------------

BLOCKED_MODULES = {"os", "subprocess", "socket", "shutil", "importlib", "ctypes", "builtins", "sys", "multiprocessing", "http", "urllib", "ftplib", "smtplib"}
BLOCKED_NAMES = {"__import__", "exec", "eval", "compile", "open", "breakpoint"}
BLOCKED_ATTRS = {"write_text", "write_bytes", "unlink", "rmdir", "rename", "replace", "system", "popen", "remove", "removedirs", "rmtree", "touch", "mkdir"}


def guard_python(code):
    try:
        tree = ast.parse(code)
    except SyntaxError as error:
        raise BridgeError(f"syntax error: {error}", "python_syntax_error")
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module or ""]
            for name in names:
                if name.split(".")[0] in BLOCKED_MODULES:
                    raise BridgeError(f"import of '{name}' is not allowed in run_python", "python_blocked_import")
        elif isinstance(node, ast.Name) and node.id in BLOCKED_NAMES:
            raise BridgeError(f"use of '{node.id}' is not allowed in run_python", "python_blocked_name")
        elif isinstance(node, ast.Attribute) and node.attr in BLOCKED_ATTRS:
            raise BridgeError(f"call of '.{node.attr}' is not allowed in run_python", "python_blocked_attribute")


def cmd_run_python(args):
    check_revision(args)
    code = args.get("code") or ""
    guard_python(code)
    stdout = io.StringIO()
    namespace = {"bpy": bpy, "__name__": "__zcode_run_python__"}
    try:
        with contextlib.redirect_stdout(stdout):
            exec(compile(code, "<run_python>", "exec"), namespace)  # noqa: S102 - 受审批流保护的逃生口
    except Exception:  # noqa: BLE001
        raise BridgeError(traceback.format_exc(limit=5), "python_error", {"stdout": stdout.getvalue()[-4000:]})
    finally:
        bump()
    return {"stdout": stdout.getvalue()[-16000:]}


COMMANDS = {
    "ping": lambda args: {"pong": True, "blender": bpy.app.version_string},
    "open": cmd_open,
    "inspect_scene": cmd_inspect_scene,
    "list_objects": cmd_list_objects,
    "inspect_object": cmd_inspect_object,
    "set_transform": cmd_set_transform,
    "set_material": cmd_set_material,
    "set_camera": cmd_set_camera,
    "set_visibility": cmd_set_visibility,
    "export_glb": cmd_export_glb,
    "render": cmd_render,
    "save": cmd_save,
    "run_python": cmd_run_python,
}


class _BridgeNamespace:
    """把本文件的全局暴露给 bridge_create（属性读取即 globals 查找；Blender 以 exec 跑脚本，sys.modules 里没有它）。"""

    def __getattr__(self, name):
        return globals()[name]


def reset_revision():
    global REVISION
    REVISION = 0


COMMANDS.update(bridge_create.register(_BridgeNamespace()))


def parse_cli():
    global WORKSPACE_ROOT, OUTPUT_ROOT
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    WORKSPACE_ROOT = os.environ.get("ZCODE_WORKSPACE_ROOT")
    for i, arg in enumerate(argv):
        if arg == "--workspace" and i + 1 < len(argv):
            WORKSPACE_ROOT = argv[i + 1]
        if arg == "--output-root" and i + 1 < len(argv):
            OUTPUT_ROOT = argv[i + 1]
    if not WORKSPACE_ROOT:
        raise SystemExit("bridge.py requires --workspace <root> or ZCODE_WORKSPACE_ROOT")
    WORKSPACE_ROOT = os.path.abspath(WORKSPACE_ROOT)
    if OUTPUT_ROOT:
        OUTPUT_ROOT = os.path.abspath(OUTPUT_ROOT)


def main():
    parse_cli()
    emit({"event": "ready", "blender": bpy.app.version_string, "workspace": WORKSPACE_ROOT})
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            emit({"event": "log", "message": f"ignoring non-json line: {line[:80]}"})
            continue
        req_id = request.get("id")
        cmd = request.get("cmd")
        if cmd == "quit":
            break
        handler = COMMANDS.get(cmd)
        if handler is None:
            emit({"id": req_id, "ok": False, "error": {"code": "unknown_command", "message": f"unknown command: {cmd}"}, "state": current_state()})
            continue
        try:
            result = handler(request.get("args") or {})
            emit({"id": req_id, "ok": True, "result": result, "state": current_state()})
        except BridgeError as error:
            emit({"id": req_id, "ok": False, "error": {"code": error.code, "message": str(error), "details": error.details}, "state": current_state()})
        except Exception as error:  # noqa: BLE001 - 任何异常都要回给客户端而不是让进程死掉
            emit({"id": req_id, "ok": False, "error": {"code": "internal_error", "message": f"{type(error).__name__}: {error}", "details": traceback.format_exc(limit=5)}, "state": current_state()})
    bpy.ops.wm.quit_blender()


if __name__ == "__main__":
    main()
