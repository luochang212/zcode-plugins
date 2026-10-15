# Blender 插件工具表与场景状态信封

假引擎的版本字段必须与 fake-scene 常量一致；即使 revision 冲突，仍返回包含 state/error 的结构化信封。重新导出常量不能替代本地导入。

Blender 进程（`blender/bridge.py`）是场景状态的唯一 owner，插件 MCP server 只持有桥缓存的 `SceneState`（file / revision / selected / camera / engine）。每个变更工具都带 `expectedRevision`：server 先用缓存快速拒绝过期请求（不打扰 Blender），桥内 `check_revision` 再做权威校验；冲突返回 `revision_conflict`，state 里给当前 revision 让模型重读，绝不覆盖。每个工作区一条桥（`createBridgeRegistry`），关闭时 `closeAll`。

工具表固定为 `CORE_TOOLS`，`run_python` 只在 `allowPython` 打开时注册；`export_glb` / `pick_scene_file` 是 app-only（面板回调，不进模型工具表）；所有向模型提供面板的工具统一带 fullscreen 偏好，从引擎检测开始就在右侧打开，避免先在对话内挂载再移动。面板经 `ui://blender/panel.html` 提供（`ui/dist/panel.html` 单文件，缺失时退回占位页），渲染与导出产物经 `blender://render/{id}.png`、`blender://export/{id}.glb` 资源读取；GLB 超过 `MAX_GLB_BYTES` 先减半面数重试一次。`ZCODE_BLENDER_FAKE_ENGINE=1` 用内存假引擎替代 Blender，供 CI / e2e。

运行时源码是 .mjs，`src/contract.ts` 是 TS 侧镜像，`src/contract.test.ts` 用真实 server 校验两边一致。

桥从成功响应的 `state.file` 维护最新恢复路径（包括新建、打开和另存），进程 ready 且文件恢复完成后才接受等待命令；旧进程事件不能影响新进程。已取消且尚未发送的命令不能启动或结束 Blender；保存确认与原请求共享取消信号。面板尊重明确的 `file: null`，不得保留旧文件名。恢复只保证最近保存的磁盘版本，未增加自动保存。

构建分发：本插件的 package.json 声明 build 与 stage。根脚本只调度和校验；stage 按 ZCODE_PLUGIN_INSTALL_DIR 复制本插件额外运行资源，并在完成标记写入前结束。安装目录布局与运行时接口保持不变。

插件身份：目录和清单使用 `blender`，对应 MCP 页面资源使用 `ui://blender/` 命名空间；客户端、服务端与集成测试保持一致。
