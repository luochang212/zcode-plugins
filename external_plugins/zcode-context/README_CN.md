# zcode-context

[English](./README.md)

一个只读、离线的 ZCode UI 插件，在会话侧栏里展示每一次请求的上下文：会话用量、模型输入组成、逐步差异和压缩事件。

- **只读** —— 不写入 ZCode 数据、不修改任何设置、不调用模型。
- **离线** —— 不发起任何网络请求，只读取 ZCode 已经记录在本机的数据。
- **实时** —— 面板随会话更新：注入、压缩和模型切换发生时即刻呈现。

## 它能回答什么

| 视图 | 回答的问题 |
| --- | --- |
| 请求概览 | 上下文为什么这么大？每次请求的大小、按类别（系统指令、工具定义、用户消息、助手消息、工具结果）的组成，以及随步骤的变化趋势。 |
| 组成与趋势 | 哪一类内容占得最多，以及它们是在哪一步进入对话的。 |
| 请求差异 | 两个步骤之间变了什么 —— 新增了什么、移除了什么（压缩前后对比尤其有用）。 |
| 上下文事件 | 运行时注入、压缩（包括被摘要掉的内容）和模型切换，直接读自会话记录。 |

点击事件即可打开它带进上下文的那一项；压缩事件还可以展开「被摘要的内容」。

## 环境要求

- ZCode Desktop 3.15.1+（支持会话侧栏 / MCP Apps）。
- Node.js 24+（MCP server 以 `node` 启动，需在 `PATH` 中可用）。
- ZCode CLI 本地数据位于 `~/.zcode/cli`（默认），或自定义数据目录（见配置）。

## 安装

在 ZCode 插件市场安装并启用 **zcode-context**，本地工作区的会话即可使用「上下文」侧栏面板。

## 组件

- **MCP server**（`context`，stdio）：提供只读检查工具 `get_context_summary` 和 `get_context_request`，并通过 `ui://zcode-context/panel.html` 提供面板页面。
- **UI surface**（`context`，availability `session`）：会话侧栏面板。

## 配置

| 选项 | 说明 | 默认值 |
| --- | --- | --- |
| `dataRoot` | 包含 `db/`、`rollout/` 和 `log/` 的目录。留空使用 `~/.zcode/cli`。 | 空 |
| `dbPath` | 可选的会话数据库绝对路径。 | 空 |

## 工作原理与隐私

插件只读取 ZCode CLI 的本地记录 —— 会话数据库（`db/db.sqlite`）、rollout 文件和日志 —— 并从中推导用量、组成、差异和事件。它不向任何地方发送数据：无遥测、无网络访问、无模型调用。所有处理都在你机器上的插件进程内完成。

## 依赖与副作用

- 运行时依赖（`@modelcontextprotocol/sdk`、`zod`）在构建时打包；许可证声明生成到 `dist/THIRD_PARTY_NOTICES.txt`。
- 无网络访问、不在自身进程内存之外写文件、无 Hook、无命令。
- 读取范围：`~/.zcode/cli/db/`、`~/.zcode/cli/rollout/`、`~/.zcode/cli/log/`（或配置的数据目录）。

## 开发

源码位于 [`ui-plugins/zcode-context/`](../../ui-plugins/zcode-context)。在仓库根目录执行 `pnpm install` 和 `pnpm build` 构建；测试用 `node --test test/*.test.mjs` 运行。上游项目：<https://github.com/Kevinzzz6/zcode-context>。

## 许可证

[MIT](./LICENSE)
