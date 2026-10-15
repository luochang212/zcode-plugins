---
name: blender
description: 用户要看、改、渲染 Blender 场景（.blend）时怎么用 blender 的工具
---

# Blender 插件

用户提到 ".blend / Blender 场景 / 改材质 / 摆相机 / 渲染一张图" 时按这个流程。

## 默认展示位置

- Blender 产物默认在右侧 Blender 面板展示：场景在“场景”标签，渲染图在“渲染”标签。打开、新建场景和渲染预览时均遵循这一默认位置。
- 对话中只给简短结果说明和需要交付的文件链接，不嵌入渲染图片，不重复展示交互面板。只有用户明确要求在对话中展示时才例外。
- 使用插件工具打开场景、生成渲染预览，让右侧面板展示结果；不要用 Markdown 图片或其他内联展示方式代替面板。

## 能力分层

| 层        | 条件                                                                                            | 能做什么                                                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| full      | `ensure_engine` 返回 `tier: "full"`（用户配置路径、已安装的 Blender、或插件下载的便携版 5.2.1） | 打开、检视、修改、渲染、保存，全部工具可用                                                                                                        |
| gltf-only | `tier: "gltf-only"`：没有引擎                                                                   | 只能靠面板浏览已有 GLB；所有需要引擎的工具返回 `[engine_missing]`。先告诉用户可以让插件下载便携版（约 330–360 MB），或在插件设置里填 Blender 路径 |

不确定状态时先调 `ensure_engine`（不带参数：找不到引擎时会弹窗问用户是否下载；用户明确说"下载"再带 `download: true`）。下载期间工具会持续上报进度，最长等 15 分钟。

## 编辑闭环：inspect → 带 expectedRevision 改 → render_preview

```
inspect_scene ──► state.revision = N
      │
      ▼
set_*( ..., expectedRevision: N ) ──► 成功：state.revision = N+1
      │                               │
      │  [revision_conflict]          ▼
      └──► 有人（用户/面板/上一条工具）改过场景 ──► 重新 inspect_scene，用新 revision 再改
      ▼
render_preview ──► blender://render/<id>.png（面板"渲染"标签会显示）
```

1. `open_scene(path)`：路径必须在工作区里；要选文件时不要猜，问用户或让用户在面板里选（面板用 `pick_scene_file`，模型看不到这个工具）。**没有现成 `.blend`、用户要"从零建一个"时用 `new_scene(path)`**：默认 `basic` 模板带一台相机和一盏太阳光，`empty` 什么都没有；已存在的文件不会被覆盖（要覆盖显式传 `overwrite: true`，先问用户）。新建后 revision 为 0。
   - 往场景里加东西用 `add_object(type, …)`：`cube / sphere / plane / cylinder / cone / torus / light / camera / empty`。mesh 可直接给 `size`（边长或直径）与 `baseColor`；灯给 `light: { type: POINT|SUN|SPOT|AREA, energy, color }`；相机给 `lens`，场景没相机时自动成为渲染相机。它也是变更工具，同样带 `expectedRevision`，每加一个 revision +1。名字重复会自动变成 `Cube.001`，以返回结果里的 `object.name` 为准。
   - 典型"建一个方块场景"：`new_scene("scenes/cube.blend")` → `add_object(cube, location [0,0,1], baseColor …, expectedRevision 0)` → `add_object(plane, size 20, expectedRevision 1)` → `set_camera(lookAt "Cube")` → `render_preview`。不要用 Bash 去跑 Blender 命令行写脚本，这些工具就够了；结构化工具做不到的再看 `run_python`。
2. **每次修改前先 `inspect_scene`**，拿到对象名和 `state.revision`。对象名区分大小写，不要凭记忆写名字。需要单个物体的细节用 `inspect_object(name)`。
3. 修改：`set_transform`、`set_material`、`set_camera`、`set_visibility`、`add_object`。**每个都传上一步看到的 `expectedRevision`**；返回 `[revision_conflict]` 说明场景在你 inspect 之后被改过（用户在面板里操作、或你自己上一条修改已经把 revision 推到 N+1），结果里 `state.revision` 是当前值——重新 `inspect_scene` 再改，不要盲目重试，也不要直接拿 `state.revision` 当 expectedRevision 跳过 inspect（场景内容可能也变了）。
   - 连续多次修改：每次成功结果的 `state.revision` 就是下一次的 `expectedRevision`，不必每次都 inspect；但只要中间夹了别人的修改就会冲突，按上面处理。
   - `set_material` 只覆盖 Principled BSDF 的 baseColor / metallic / roughness / emission；"磨砂金属" = metallic 1、roughness 0.6 左右。
   - `set_camera` 优先用 `lookAt` 对准物体而不是手算旋转。
   - 旋转单位是角度，颜色是 0..1。
4. **改完就 `render_preview`** 让用户看到效果。渲染引擎跟着用户在面板里选的走：面板会经插件上下文（用户消息尾部的 `# Plugin context:` 块，structuredContent 里 `renderEngine: "eevee" | "cycles"`）告诉你，调 `render_preview` 时把它传成 `engine`；用户选了 cycles 就再给 `samples: 128` 左右（CPU 渲染要一两分钟，先说一句）。用户没选过就不传，用插件设置的默认值。EEVEE 快但是近似，Cycles 才是接近成图的质量——用户说"和场景里看到的差距大 / 渲染得更真实"时推荐切 Cycles。结果里的 `blender://render/<id>.png` 是可读资源，面板的"渲染"标签会显示；文字里给一句结论即可，不要复述参数。默认 640×480、16 采样；用户要成图再加大。EEVEE 失败会自动退到 Cycles CPU，结果 `fallback: true` 时提一句。
5. 用户满意后 `save_scene`。不带 path 是原地保存；覆盖已有文件时工具会向用户弹确认，等结果，不要替用户决定。另存用工作区内的新路径。

## 与面板协作

- 面板（侧栏 "Blender"）和你共用同一个 Blender 进程与同一份 revision。用户在面板里打开文件、点选 / 取消选中物体、调整视角、切换渲染引擎、刷新发现 revision 变化后，面板会经 `updateModelContext` 把 `{ file, revision, selected, cameraPose, renderEngine }` 作为插件上下文附在用户下一条消息尾部（`# Plugin context:` 块，文本 "Blender 面板：…" + JSON）：**用户说"这个 / 选中的物体"时，先看上下文里的 `selected`，不必再问是哪一个**；`file` 是当前打开的场景。宿主不会自动把面板状态喂给你，没有上下文块就说明用户没在面板里动过。
- 同一份上下文里文本与 JSON 内容一致，不重复解读；后一次汇报会替换前一次，以最新一条为准。
- 面板“使用场景”菜单提供调灯光、找机位的提示词，包含当前文件与选中物体。用户可复制完整提示词，粘贴并发送后按普通请求处理，仍要走 inspect → 改 → render_preview。
- 你每次成功修改后面板会自动刷新预览（按 revision 比对），不需要你调用 `export_glb`。

## run_python

只有插件设置 `allowPython` 打开时才有这个工具（工具列表里没有它就是没开，需要时告诉用户去插件设置里打开"允许 run_python"，不要用 Bash 绕过去跑 Blender）。它是逃生口：只在结构化工具做不到（加修改器、布尔运算、批量操作、动画）时用；脚本里 `bpy` 已注入，`print` 会回到结果。禁止导入 os / subprocess / socket / shutil / importlib / ctypes，也不能写文件。它同样接受 `expectedRevision`，每次运行都会让 revision +1，之后重新 `inspect_scene`。宿主会先向用户弹审批，被拒绝就换结构化工具或说明做不到。

## 不要做

- 不要在没有 `inspect_scene` 的情况下按记忆修改。
- 不要把 `.blend` 文件当文本读；一切场景信息来自工具。
- `export_glb`、`pick_scene_file` 是面板专用工具，模型工具列表里没有，也不要尝试调用。
