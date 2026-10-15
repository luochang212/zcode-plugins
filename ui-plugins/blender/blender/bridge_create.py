"""bridge.py 的创建类命令：new_scene / add_object。

单独成文件是为了不让 bridge.py 继续膨胀；它不是独立模块，运行时由 bridge.py 以 `register(namespace)` 注入
自己的全局（bpy 访问器、BridgeError、guard_path、bump、check_revision、object_summary、cmd_inspect_scene），
这里不 import bridge（bridge 以 __main__ 运行，再 import 会重新执行一遍）。
"""

import math
import os

import bpy
from mathutils import Vector

B = None  # bridge.py 的命名空间，register() 时注入

# 允许创建的类型 → (bpy.ops.mesh 原语名, 尺寸参数名)
MESH_PRIMITIVES = {
    "cube": ("primitive_cube_add", "size"),
    "sphere": ("primitive_uv_sphere_add", "radius"),
    "plane": ("primitive_plane_add", "size"),
    "cylinder": ("primitive_cylinder_add", "radius"),
    "cone": ("primitive_cone_add", "radius1"),
    "torus": ("primitive_torus_add", "major_radius"),
}
LIGHT_TYPES = {"POINT", "SUN", "SPOT", "AREA"}


def _fail(message, code="invalid_args", details=None):
    raise B.BridgeError(message, code, details)


def _unique_name(base):
    if bpy.data.objects.get(base) is None:
        return base
    index = 1
    while bpy.data.objects.get(f"{base}.{index:03d}") is not None:
        index += 1
    return f"{base}.{index:03d}"


def _link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def _apply_base_color(obj, rgba):
    """给新建 mesh 挂一份带 Principled BSDF 的材质并设 Base Color；复用 cmd_set_material 的节点查找。"""
    material = bpy.data.materials.new(name=f"{obj.name}_Material")
    material.use_nodes = True
    obj.data.materials.append(material)
    node = B.principled_of(material)
    if node is None:
        node = material.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
        output = next((n for n in material.node_tree.nodes if n.type == "OUTPUT_MATERIAL"), None)
        if output:
            material.node_tree.links.new(node.outputs["BSDF"], output.inputs["Surface"])
    color = list(rgba)
    if len(color) == 3:
        color.append(1.0)
    B._input(node, "Base Color").default_value = color


def _add_basic_rig():
    """basic 模板：一台看向原点的相机 + 一盏太阳光，位置与 Blender 默认启动场景一致。"""
    cam = _link(bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera")))
    cam.location = Vector((7.3589, -6.9258, 4.9583))
    cam.rotation_euler = [math.radians(v) for v in (63.5593, 0.0, 46.6919)]
    bpy.context.scene.camera = cam
    light = _link(bpy.data.objects.new("Light", bpy.data.lights.new("Light", "SUN")))
    light.location = Vector((4.0762, 1.0055, 5.9039))
    light.rotation_euler = [math.radians(v) for v in (37.261, 3.16371, 106.936)]
    light.data.energy = 3.0


def cmd_new_scene(args):
    """新建空场景并保存到工作区内的 .blend；revision 归 0，返回场景摘要。"""
    path = B.guard_path(args.get("path"))
    if not path.lower().endswith(".blend"):
        _fail("path must end with .blend")
    if os.path.exists(path) and not args.get("overwrite"):
        _fail(f"file already exists: {path} (pass overwrite: true to replace it)", "file_exists")
    template = args.get("template") or "basic"
    if template not in ("empty", "basic"):
        _fail(f"unknown template: {template}")
    bpy.ops.wm.read_homefile(use_empty=True)
    if template == "basic":
        _add_basic_rig()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=path, copy=False)
    B.reset_revision()
    return B.cmd_inspect_scene({})


def _add_mesh(kind, name, args):
    op_name, size_param = MESH_PRIMITIVES[kind]
    kwargs = {}
    if args.get("size") is not None:
        size = float(args["size"])
        # 原语的尺寸语义各异：cube/plane 用边长，其余用半径（边长的一半）。
        kwargs[size_param] = size if size_param == "size" else size / 2
    getattr(bpy.ops.mesh, op_name)(**kwargs)
    obj = bpy.context.view_layer.objects.active
    if obj is None:
        _fail("primitive operator did not produce an object", "internal_error")
    obj.name = name
    if obj.data is not None:
        obj.data.name = name
    return obj


def _add_light(name, args):
    spec = args.get("light") or {}
    light_type = str(spec.get("type") or "POINT").upper()
    if light_type not in LIGHT_TYPES:
        _fail(f"unknown light type: {light_type}")
    obj = _link(bpy.data.objects.new(name, bpy.data.lights.new(name, light_type)))
    if spec.get("energy") is not None:
        obj.data.energy = float(spec["energy"])
    if spec.get("color") is not None:
        obj.data.color = [float(v) for v in spec["color"][:3]]
    return obj


def _add_camera(name, args):
    obj = _link(bpy.data.objects.new(name, bpy.data.cameras.new(name)))
    if args.get("lens") is not None:
        obj.data.lens = float(args["lens"])
    if bpy.context.scene.camera is None or args.get("makeActive"):
        bpy.context.scene.camera = obj
    return obj


def cmd_add_object(args):
    """往当前场景加一个物体：mesh 原语 / 灯 / 相机 / 空物体。返回 object_summary，revision +1。"""
    B.check_revision(args)
    kind = str(args.get("type") or "").lower()
    default_name = kind.capitalize() if kind else "Object"
    name = _unique_name(str(args.get("name") or default_name))
    if kind in MESH_PRIMITIVES:
        obj = _add_mesh(kind, name, args)
    elif kind == "light":
        obj = _add_light(name, args)
    elif kind == "camera":
        obj = _add_camera(name, args)
    elif kind == "empty":
        obj = _link(bpy.data.objects.new(name, None))
    else:
        _fail(f"unknown object type: {kind}")
    if args.get("location") is not None:
        obj.location = Vector(args["location"])
    if args.get("rotation") is not None:
        obj.rotation_euler = [math.radians(v) for v in args["rotation"]]
    if args.get("scale") is not None:
        scale = args["scale"]
        obj.scale = Vector(scale if isinstance(scale, (list, tuple)) else [scale, scale, scale])
    if kind in MESH_PRIMITIVES and args.get("baseColor") is not None:
        _apply_base_color(obj, args["baseColor"])
    B.bump()
    bpy.context.view_layer.update()
    return B.object_summary(obj)


def register(namespace):
    """由 bridge.py 调用：注入命名空间并返回要合并进 COMMANDS 的表。"""
    global B
    B = namespace
    return {"new_scene": cmd_new_scene, "add_object": cmd_add_object}
