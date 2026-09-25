# Wind 万得（wind）

[English](./README.md)

万得股票、海外股票、指数、基金、债券、宏观经济与公告研报数据 MCP 服务。本插件只封装远程 MCP，不提供命令、技能、Agent 或 Hook。

## 使用

1. 在 ZCode 插件管理器中安装并启用「Wind 万得」。
2. 在会话中确认下列 MCP 工具已加载，然后用自然语言提出查询。例如：

> 使用万得查询中国最近可用的 GDP 数据，注明统计期、单位和来源。

Agent 应从当前会话发现的工具中选择对应服务，按工具 schema 传参；不应猜测工具名。服务命名空间为 `plugin:wind:<server-key>`。本插件没有斜杠命令。

## MCP 服务

| Server key | 网关路由标识 |
| --- | --- |
| `wind-stock` | `finance_wind_stock` |
| `wind-global-stock` | `finance_wind_global_stock` |
| `wind-index` | `finance_wind_index` |
| `wind-fund` | `finance_wind_fund` |
| `wind-bond` | `finance_wind_bond` |
| `wind-economic` | `finance_wind_economic` |
| `wind-docs` | `finance_wind_docs` |

配置以 [`.mcp.json`](./.mcp.json) 的 `mcpServers` 为准，ZCode 自动发现插件根目录下的此文件。所有服务使用远程 HTTP，地址前缀为 `${ZCODE_BASE_URL}/api/v1/mcp/server/`。

## 认证与权限

需要 ZCode 登录态及对应付费服务权限（`requiresPaidPlan: true`）。宿主通过 `auth: {type: zcode_official, provider: jwt_token}` 注入认证，无须配置数据商 API key、token 或账号。

如果工具未加载，先检查插件是否启用；如果认证或权限失败，检查登录态与套餐权限。查询失败时明确报告错误，不编造数据。

## 范围与副作用

插件自身不运行本地程序、不写文件、不安装依赖。查询通过 ZCode 网关发送到远程服务；插件没有直连数据商的端点，也不携带凭据。

现有金融业务插件仍保留各自的 MCP。与这些插件同时启用时，同一数据源可能以不同插件命名空间重复出现，按需启用即可。
