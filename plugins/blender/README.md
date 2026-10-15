# blender

Git 市场安装包包含已编译的 MCP 服务与 UI 资源，无需用户手动构建。运行需要 Node.js 24+ 和支持 Plugin UI 的 ZCode Desktop。下方构建步骤供源码开发使用。

通过插件市场安装并启用本插件。源码开发时在仓库根目录运行 `pnpm build`，生成 `plugins/blender` 下的服务与离线面板；Blender 引擎仍按原流程探测或下载。
在 ZCode 对话旁打开 Blender 场景：Agent 通过 MCP 工具检视、修改、渲染 `.blend`，面板用 Three.js 轻量浏览。
当前实现包含引擎获取、桥、工具、Skill、Three.js 面板、revision 编辑闭环和假引擎模式；面板通过官方 MCP Apps SDK 读取资源并接收工具结果。

## 内容

开发源码位于 `ui-plugins/blender/`；安装清单与 skill 位于 `plugins/blender/`。下表中的源码路径相对前者，清单与 skill 路径相对后者。

| 文件                                         | 作用                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `.zcode-plugin/plugin.json`                  | 插件清单：stdio MCP 服务 `blender`、`userConfig`、`ui.surfaces` 面板入口                                     |
| `server.mjs`                                 | 入口：读 env → `createBlenderServer` → stdio                                                                 |
| `src/server-factory.mjs`                     | 组装 server、引擎状态、桥注册表；单测直接调用                                                                |
| `src/engine.mjs`                             | 引擎发现（用户路径 → 已安装 → 便携版 → 无）与官方便携版下载（sha256、解压/挂载、进度）                       |
| `src/bridge-client.mjs`                      | JSON-lines 桥客户端：超时、崩溃重启并重开文件、单工作区单进程、空闲 5 分钟退出、AbortSignal                  |
| `blender/bridge.py`                          | 跑在 `blender -b` 里的 bpy 命令循环；revision、路径守卫、EEVEE→Cycles 回退、run_python 导入守卫              |
| `blender/bridge_create.py`                   | 创建类命令 `new_scene` / `add_object`（bpy 原语、灯、相机、空物体），由 bridge.py 注入命名空间后合并进命令表 |
| `src/tools/*.mjs`                            | MCP 工具与资源                                                                                               |
| `ui/src/*.ts`                                | 面板源码（Three.js）；`scripts/build-ui.mjs` 用 esbuild 打成单文件 `ui/dist/panel.html`（构建产物，不提交）  |
| `ui/index.html`                              | 占位页：dist 缺失时服务端退回它                                                                              |
| `skills/blender/SKILL.md`                    | 教模型：inspect → 带 expectedRevision 改 → render_preview；与面板协作                                        |
| `src/fake-engine.mjs`、`src/fake-assets.mjs` | 假引擎：内存场景 + 程序生成的 GLB / PNG，`ZCODE_BLENDER_FAKE_ENGINE=1` 启用                                  |
| `src/contract.test.ts`                       | vitest：构建服务的工具/资源合同、假引擎场景操作与 revision 冲突                                              |

## 安装

开发时先在仓库根运行 `pnpm install --frozen-lockfile` 和 `pnpm build`，再在 ZCode 插件商店添加 `dist/local-marketplace` 的绝对路径作为本地 marketplace 来源，安装并启用 `blender`。不要添加仓库根目录，其官方来源名称属于保留名称。源码更新后重新构建、刷新来源、重新安装插件，并在新会话测试。安装目录为 `plugins/blender`，不能直接安装 `ui-plugins` 下的源码。发行包包含运行依赖与面板，不需要在安装目录执行 npm 安装。

`userConfig`（插件设置页）：

| 键                  | 默认    | 说明                                                                               |
| ------------------- | ------- | ---------------------------------------------------------------------------------- |
| `blenderPath`       | 空      | Blender 可执行文件；留空自动探测                                                   |
| `allowPython`       | `false` | 开启后才注册 `run_python`。在插件设置页打开后重启插件服务                          |
| `renderEngine`      | `eevee` | `eevee` / `cycles`（清单 `userConfig` 没有 enum 类型，服务端校验，非法值回 eevee） |
| `engineDownloadDir` | 空      | 便携版落盘目录，留空用 `<plugin-data>/engine`                                      |

## 引擎分层

| 层        | 来源                                                                                                                           | 说明                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| full      | `blenderPath` → `/Applications/Blender.app`、`Program Files\Blender Foundation\Blender 5.2\`、PATH 上的 `blender` → 插件便携版 | 全部工具可用                                                                           |
| gltf-only | 三者都没有                                                                                                                     | 需要引擎的工具返回 `[engine_missing]`；`ensure_engine` 会通过 elicitation 询问是否下载 |

便携版固定 **Blender 5.2.1 LTS**，文件名已对照 `https://download.blender.org/release/Blender5.2/` 核对，sha256 取自同目录 `blender-5.2.1.sha256`：

| 平台                | 包                               | 大小（约） | 解压方式                                                  |
| ------------------- | -------------------------------- | ---------- | --------------------------------------------------------- |
| windows-x64 / arm64 | `blender-5.2.1-windows-*.zip`    | 340–360 MB | `tar.exe -xf`（Windows 10+ 自带 bsdtar）                  |
| linux-x64           | `blender-5.2.1-linux-x64.tar.xz` | 350 MB     | `tar -xJf`                                                |
| macos-arm64         | `blender-5.2.1-macos-arm64.dmg`  | 330 MB     | `hdiutil attach` → `cp -R Blender.app` → `hdiutil detach` |
| macos-x64           | 无                               | —          | 5.2 系列官方没有 Intel 包，只能装 App 或填路径            |

下载到 `<engineDir>/.download/*.part`，校验通过后解压并写 `engine.json`；失败或中止清掉临时目录。进度通过 MCP `notifications/progress` 上报（按 1% 节流），工具声明 `_meta.timeoutMs = 900000`。

## 工具

所有结果 `structuredContent` 都带 `state: { file, revision, selected, camera, engine }`；错误结果 `isError: true`，文本 `[code] message`，`structuredContent.error.code` 与 `state`。

| 工具              | 可见性                        | 参数                                                                                                                                                                                               | 说明                                                                                                                                     |
| ----------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `ensure_engine`   | model+app                     | `download?: boolean`                                                                                                                                                                               | 探测/下载引擎；`tier: "full" \| "gltf-only"`                                                                                             |
| `open_scene`      | model+app（偏好 fullscreen）  | `path`                                                                                                                                                                                             | 打开工作区内 `.blend`，返回场景摘要，revision 归 0                                                                                       |
| `new_scene`       | model+app（偏好 fullscreen）  | `path, template?(basic\|empty), overwrite?`                                                                                                                                                        | 新建场景并保存到工作区内的 `.blend` 再打开；`basic` 带相机 + 太阳光；已存在的文件返回 `[file_exists]`，除非 `overwrite: true`            |
| `add_object`      | model+app                     | `type(cube\|sphere\|plane\|cylinder\|cone\|torus\|light\|camera\|empty), name?, location?, rotation?, scale?, size?, baseColor?, light?{type,energy,color}, lens?, makeActive?, expectedRevision?` | 往场景加一个物体；名字自动去重（`Cube.001`）；mesh 的 `baseColor` 直接建 Principled 材质；首台相机自动成为渲染相机                       |
| `inspect_scene`   | model+app                     | —                                                                                                                                                                                                  | 对象、材质、相机、灯、渲染设置、revision                                                                                                 |
| `inspect_object`  | model                         | `name`                                                                                                                                                                                             | 变换、尺寸、材质 Principled 参数、修改器、子物体、自定义属性                                                                             |
| `set_transform`   | model+app                     | `name, location?, rotation?(度), scale?, expectedRevision?`                                                                                                                                        |                                                                                                                                          |
| `set_material`    | model+app                     | `name, slot?, baseColor?, metallic?, roughness?, emissionColor?, emissionStrength?, expectedRevision?`                                                                                             | 只动 Principled BSDF 这几个通道                                                                                                          |
| `set_camera`      | model+app                     | `name?, location?, rotation?, lookAt?, lens?, expectedRevision?`                                                                                                                                   | 无相机时新建                                                                                                                             |
| `set_visibility`  | model+app                     | `name, hidden?, hideRender?, expectedRevision?`                                                                                                                                                    |                                                                                                                                          |
| `render_preview`  | model+app                     | `width?, height?, samples?, engine?`                                                                                                                                                               | 返回 `blender://render/<id>.png`；EEVEE 失败退 Cycles CPU、采样 ≤16，`fallback: true`                                                    |
| `save_scene`      | model                         | `path?`                                                                                                                                                                                            | 目标已存在时 elicitation 确认覆盖                                                                                                        |
| `export_glb`      | app                           | `path?, draco?(默认 false), maxFaces?`                                                                                                                                                             | 面板预览用；不带纹理；超预算临时 Decimate；> 8 MiB 减半 maxFaces 重导一次，仍超限 `[export_too_large]`；返回 `blender://export/<id>.glb` |
| `pick_scene_file` | app                           | `limit?`                                                                                                                                                                                           | 递归列出工作区 `.blend`（跳过 node_modules/.git/隐藏目录）                                                                               |
| `run_python`      | model（`allowPython` 才注册） | `code, expectedRevision?`                                                                                                                                                                          | AST 守卫禁 os/subprocess/socket/shutil/importlib/ctypes 与写盘调用；每次 revision +1                                                     |

`expectedRevision` 不匹配时：服务端先用桥缓存的最新 state 快速拒绝（不调 Blender），桥内 `check_revision` 再做权威校验；两处都返回 `[revision_conflict]`，`structuredContent.error.code = "revision_conflict"`，`details: { expectedRevision, currentRevision }`，`state` 回显当前 revision。

资源：`ui://blender/panel.html`（面板，优先 `ui/dist/panel.html`）、`blender://render/{id}.png`（`image/png` blob）、`blender://export/{id}.glb`（`model/gltf-binary` blob）。产物落在 `<plugin-data>/output/{renders,exports}/`。

## 面板

```
ui/src/main.ts ── 装配 ──┬─ api.ts         官方 App 的本地页面封装（callTool / readResource / setWidgetState / updateModelContext / sendFollowUpMessage）
                         ├─ panelState.ts  纯 reducer：工具结果 → PanelState（唯一数据源）；widgetState 投影；摘要文案
                         ├─ viewer.ts      Three.js：GLTFLoader.parse(ArrayBuffer)、OrbitControls、网格地面、点选 + BoxHelper 高亮
                         ├─ tree.ts        对象树（类型图标 / 隐藏 / 活动相机、键盘导航）+ 只读属性（XYZ 变换、信息、材质色块与数值条）
                         ├─ chrome.ts      头部 / 工具条 / 空态 / 渲染页的 DOM 投影
                         ├─ icons.ts       内联 SVG 图标
                         └─ i18n.ts        zh-CN / en-US
```

- 空态：`pick_scene_file` 结果做打开按钮、引擎状态、提示"也可以在对话里直接给 .blend 路径"。
- 预览数据：`callTool("export_glb")` → `readResource(blender://export/<id>.glb)` → base64 → ArrayBuffer → `GLTFLoader.parse`。
- 刷新：宿主 `notifyToolResult`带来的 `state.revision` 与本地不同、手动"刷新"、面板可见时每 5 s `inspect_scene` 兜底，三者都只在 `glb.revision !== revision` 时重导。
- 状态：widgetState `{ file, selected, cameraPose, tab }`（清单声明可见性 `["app","model"]`，每回合自动进模型上下文）；相机拖拽只在 OrbitControls `end` 时写。用户主动动作（打开文件、选中、刷新发现 revision 变化）另发一条 `updateModelContext` 短文本。
- "调灯光 / 找机位"：`sendFollowUpMessage`，prompt 带当前文件与选中对象。
- 高度：内联卡片固定上报 520px；`displayMode === "fullscreen"` 时撑满侧栏。
- 构建：仓库根目录执行 `pnpm build`，将离线面板复制到安装目录；生成的 HTML 不提交；`pnpm --filter @zcode/plugin-blender typecheck:ui` 做类型检查。

## 桥进程

```
server.mjs ──spawn──▶ blender -b --python bridge.py -- --zcode-bridge --workspace <root> --output-root <data>/output
   │  stdin  {id, cmd, args}\n
   │  stdout {id, ok, result|error, state}\n      （非 "{" 开头的行是 Blender 噪音，忽略）
   │
   ├─ 每命令超时（默认 60 s，渲染/导出 10 min）→ 杀进程，下次调用重启
   ├─ 进程崩溃 → 在途请求全部拒绝 process_crashed → 下次调用重启并自动 open 上一次文件
   ├─ AbortSignal → 杀进程（bpy 主线程不可打断）
   └─ 空闲 5 min → 发 quit 退出
```

## 演示脚本

每一步后面是预期现象与用例编号。前提：插件已启用，工作区里有一个 `.blend`（例如 `scenes/bottle.blend`）。

1. **B01 引擎探测/下载**。输入"看看能不能用 Blender"。模型调 `ensure_engine`：本机有 Blender.app 时直接返回 `tier: "full"` 与版本；没有时弹出确认框"是否下载官方便携版 Blender 5.2.1（约 330 MB）"，同意后工具行显示下载进度条，完成后返回 `tier: "full"`（便携版在 `<plugin-data>/engine`）。拒绝则 `tier: "gltf-only"`，之后场景工具都回 `[engine_missing]`。
2. **B02 打开场景 / 从零新建**。想从零开始就说"新建一个场景，放一个橙色方块和一块地面"：模型调 `new_scene("scenes/xxx.blend")` → `add_object(cube, baseColor …)` → `add_object(plane, size 20)` → `set_camera(lookAt)` → `render_preview`，面板随之出现并显示新物体。已有文件：输入"打开 scenes/bottle.blend"。模型调 `open_scene`，结果卡片内联占位、侧栏出现 "Blender" 面板：顶部显示文件与 `revision 0`，左侧对象树列出物体（类型图标，隐藏物体变灰，活动相机带星标），中间 Three.js 预览可旋转缩放，右侧属性为空提示。也可以从"打开标签页 → 插件 → Blender"先打开面板，在空态里点工作区 `.blend` 列表中的文件。
3. **B03 面板预览与选中**。在预览里点瓶身（或点左侧列表）。物体出现橙色选框，右侧显示位置/旋转/缩放、材质基础色与可见性；面板经 `updateModelContext` 汇报，输入框上方出现"插件上下文"chip，下一条消息的请求体尾部带 `# Plugin context:` 块（structuredContent 里 `selected: ["Bottle"]`）。拖动相机松手后同样汇报一次（`cameraPose`）；同一会话内关掉再打开面板视角与选中恢复（widgetState 存宿主内存，退出桌面端后不保留）。
4. **B04 改材质并出图**。输入"把选中的改成磨砂金属，渲染看看"。模型不再问"哪个物体"：`inspect_scene`（拿 revision）→ `set_material(Bottle, metallic 1, roughness 0.6, expectedRevision)` → `render_preview`。面板预览自动刷新（revision 变了才重导 GLB），"渲染"标签显示 PNG 与尺寸/引擎/revision；EEVEE 失败时 `fallback: true`，模型提一句。
5. **B05 revision 冲突拒绝**。让模型连续发两条修改但中间在面板里点"刷新"或让另一条工具先改了场景：带旧 `expectedRevision` 的调用返回 `[revision_conflict] revision mismatch: expected 1, current 2`，`state.revision` 为当前值，工具行标红；模型按 Skill 重新 `inspect_scene` 再改，不盲目重试。桥进程也做同样校验（服务端缓存丢失时兜底）。
6. **B06 run_python 审批**。设置里打开 `allowPython`，输入"给场景加一盏侧光"。模型调 `run_python`，宿主弹审批；同意后脚本执行、revision +1、面板刷新；拒绝则工具结果为拒绝，模型说明做不到或改用结构化工具。脚本里 `import os` 会被桥拒绝 `[python_blocked_import]`。

附：面板工具条"调灯光 / 找机位"发出的用户消息下方带"来自插件 blender"来源标记（同 showcase U09）。工具条上的引擎下拉（`EEVEE · 快` / `Cycles · 高质量`）决定面板"渲染"按钮传给 `render_preview` 的 `engine`（Cycles 时附 `samples: 128`），同时写进 widgetState 的 `renderEngine` 并追加一条模型上下文，模型之后渲染也照它选。

## 假引擎模式（CI / e2e）

env `ZCODE_BLENDER_FAKE_ENGINE=1` 时服务端不启动 Blender，用 `src/fake-engine.mjs` 的内存场景替代引擎与桥：

- `ensure_engine` 返回 `tier: "full"`、`engine.kind: "fake"`；场景固定为 `Cube / Sphere / Plane`（MESH）、`Camera`、`Light`。
- 变更工具真的改内存状态并 `revision + 1`，`expectedRevision` 不匹配同样返回 `[revision_conflict]`；`open_scene` 只记录路径，不要求文件存在（e2e 不必播种 `.blend`）；`new_scene` 会落一个假文件并按 `overwrite` 语义拒绝覆盖，`add_object` 按类型造对象并自动去重名字。
- `export_glb` 写 `src/fake-assets.mjs` 程序生成的合法 GLB（一个立方体 mesh，节点按可见 MESH 命名，≤ 2 KiB）；`render_preview` 写 1×1 PNG；`run_python` 只拦截 `import os/subprocess/...` 并递增 revision。
- 桌面 e2e 通过 Electron 进程 env 传入该变量，CLI 启动 stdio MCP 子进程时继承 `process.env`。

## 测试

```bash
pnpm --filter @zcode/plugin-blender test                          # 合同与假引擎回归
pnpm --filter @zcode/plugin-blender typecheck:ui                  # 面板 TS 类型检查
pnpm test:artifacts                                            # 仓库外启动安装产物
pnpm test:pages                                                # 官方 App/AppBridge 浏览器通信
```

上述自动检查使用假引擎，不能证明真实 Blender 的下载、进程桥接或渲染能力。真实引擎需按前面的演示流程单独验证。

## 已知限制

- 预览 GLB 不带纹理（沙箱 CSP 不放行 `blob:` connect-src；也为了 8 MiB 预算），材质只反映基础色/金属度/粗糙度。
- 面板没有 Draco 解码器；`export_glb` 默认不压缩，靠减面控制体积。
- `set_material` 只覆盖 Principled BSDF 的 baseColor/metallic/roughness/emission；灯光、修改器等靠 `run_python`。
- `run_python` 的守卫是 AST 级黑名单，不是沙箱；仍需宿主审批流。
- 崩溃重启后只恢复"重新打开文件"，未保存的修改丢失，revision 从 0 重新计数。
- 命令执行期间不能被 Blender 内部取消；Abort 直接杀进程。
- 便携版下载不支持断点续传；macOS Intel 没有 5.2 官方包。
- 对象按名字匹配 GLB 节点（Blender 导出保留物体名）；重名/改名后的持久 ID 未实现。
- 未做：多进程共用同一 `.blend` 的写锁与外部修改冲突检测。

## 独立仓库构建

在 zcode-plugins 根目录执行 `pnpm install --frozen-lockfile`、`pnpm build`、`pnpm typecheck`、`pnpm test` 和 `pnpm test:artifacts`。源码位于 `ui-plugins/blender`，可安装产物位于 `plugins/blender`；不要直接安装源码目录。`python3 scripts/build_dist.py` 生成 marketplace zip。运行需要 Node.js 24；不需要主应用源码或私有插件 SDK。

## 面板交互

面板默认在右侧打开；引擎检测、场景操作和渲染预览使用一致的展示偏好。顶部单行提供使用场景、场景／渲染切换、渲染方式下拉框及独立渲染按钮。右侧紧凑面板在对象列表与属性之间切换。使用场景菜单的提示词最多显示三行，悬停或键盘聚焦时可复制完整内容，不自动发送消息。
