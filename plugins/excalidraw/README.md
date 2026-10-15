# Excalidraw for ZCode

Git 市场安装包包含已编译的 MCP 服务与 UI 资源，无需用户手动构建。运行需要 Node.js 24+ 和支持 Plugin UI 的 ZCode Desktop。下方构建步骤供源码开发使用。

本插件通过本地 marketplace 安装；下方流程用于源码目录或独立插件包。

Agent 生成可编辑图形，用户在会话侧栏继续绘图、引用选区让 Agent 局部修改，并导出 `.excalidraw`、PNG 或 SVG。

## 构建与加载

需要 Node.js 24+ 和支持 Plugin UI 的 ZCode Desktop。本仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm build
```

在 ZCode 插件商店添加 `dist/local-marketplace` 的绝对路径作为本地 marketplace 来源，安装并启用 `excalidraw`。不要添加仓库根目录，其官方来源名称属于保留名称。源码更新后重新构建、刷新来源、重新安装插件，并在新会话测试。发布时使用 `dist/plugins/excalidraw/<version>/plugin.zip`。MCP 与编辑器已打包，运行时无需安装 npm 依赖。当前交互面板支持桌面本地工作区；其他平台使用宿主普通 MCP 记录回退。

启用后可发送：“用 Excalidraw 画一个 API、缓存和数据库的架构图”。生成结果会打开侧栏。手工修改自动保存；选中元素后右键“引用选区到对话”，再发送指令，Agent 可以按稳定元素 ID 修改。未选中元素时可引用整图，文档菜单中也提供引用入口。

点击顶部画板标题可新建、导入或切换文档；“导出”打开格式与文件路径对话框，支持 `.excalidraw`、PNG、SVG。导出路径相对于当前工作区，覆盖已有文件需勾选“覆盖同名文件”。画布下方只保留 Excalidraw 自身的缩放、撤销/重做控件。

## 保存与恢复

文档存放在宿主分配的插件数据目录 `ZCODE_PLUGIN_DATA`（ZCode 下为 `~/.zcode/cli/plugins/data/<plugin-id>`，卸载插件时默认一并删除）的 `<workspace-key-hash>/documents.sqlite`；脱离宿主单独运行时退到 `~/.zcode/plugin-data/excalidraw`。`ZCODE_WORKSPACE_ROOT` 指定工作区文件路径；可信启动方可提供 `ZCODE_WORKSPACE_IDENTITY` 隔离同路径的工作区身份。

显示“已保存”表示后端已确认。强制关闭时仅保证已确认内容恢复。多窗口同时改图时，版本冲突会保留本页草稿，可以另存副本或放弃草稿后重载。

手工修改与工具修改共用当前画板的撤销/重做，撤销后的内容照常保存为新版本。同一文档的新内容更新保留已有历史和视角；切换文档、关闭重开或放弃草稿重载后重新开始历史。撤销栈不跨窗口或重启持久化。升级时移除旧的独立 AI 恢复字段和工具，保留既有画板内容、版本与幂等记录。

编辑器和字体随包分块加载，无 CDN 依赖。每份文档最多 5000 个元素、6 MiB；图片保存在原生文档中。当前不提供多人实时协作、系统剪贴板权限或云分享。

## 验证

```sh
pnpm --filter @zcode/plugin-excalidraw test
pnpm --filter @zcode/plugin-excalidraw typecheck
pnpm --filter @zcode/plugin-excalidraw smoke
pnpm --filter @zcode/plugin-excalidraw test:e2e
```

浏览器测试需先 build，并安装 Chrome（或用 `CHROME_PATH` 指定 Chromium 可执行文件）。测试使用真实 stdio MCP 和临时 SQLite，宿主桥使用测试适配，不覆盖桌面沙箱桥。截图默认保存到系统临时目录 `excalidraw-e2e`，可用 `EXCALIDRAW_E2E_ARTIFACTS` 指定目录。

包内 `licenses/` 保留 [Excalidraw](https://github.com/excalidraw/excalidraw/tree/v0.18.1) 及字体许可证，`dist/THIRD_PARTY_NOTICES.txt` 从实际打包依赖生成。

## 独立仓库构建

在 zcode-plugins 根目录执行 `pnpm install --frozen-lockfile`、`pnpm build`、`pnpm typecheck`、`pnpm test` 和 `pnpm test:artifacts`。源码位于 `ui-plugins/excalidraw`，可安装产物位于 `plugins/excalidraw`；不要直接安装源码目录。`python3 scripts/build_dist.py` 生成 marketplace zip。运行需要 Node.js 24；不需要主应用源码或私有插件 SDK。
