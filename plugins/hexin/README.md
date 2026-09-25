# RoyalFlush iFinD (hexin)

[简体中文](./README_CN.md)

MCP services for RoyalFlush iFinD stock, global stock, index, fund, and bond data. This plugin only wraps remote MCP services; it contains no commands, skills, agents, or hooks.

## Usage

1. Install and enable **同花顺 / RoyalFlush iFinD** in the ZCode plugin manager.
2. Confirm that the MCP tools below are loaded in your session, then ask a natural-language question. For example:

> Use RoyalFlush iFinD to retrieve the latest available share price for Kweichow Moutai, with the data date and source.

Agents should select the service from tools discovered in the current session and follow its tool schema instead of guessing tool names. The server namespace is `plugin:hexin:<server-key>`. This plugin has no slash commands.

## MCP services

| Server key | Gateway route identifier |
| --- | --- |
| `hexin-stock` | `finance_hexin_stock` |
| `hexin-global-stock` | `finance_hexin_global_stock` |
| `hexin-index` | `finance_hexin_index` |
| `hexin-fund` | `finance_hexin_fund` |
| `hexin-bond` | `finance_hexin_bond` |

The `mcpServers` field in [`.mcp.json`](./.mcp.json) is authoritative. ZCode automatically discovers this file at the plugin root. All services use remote HTTP with the URL prefix `${ZCODE_BASE_URL}/api/v1/mcp/server/`.

## Authentication and permissions

A ZCode login and the applicable paid service entitlement are required (`requiresPaidPlan: true`). The host injects authentication through `auth: {type: zcode_official, provider: jwt_token}`. No vendor API key, token, or account needs to be configured.

If tools are missing, check that the plugin is enabled. If authentication or authorization fails, check your login and plan permissions. Report query errors explicitly instead of inventing data.

## Scope and side effects

The plugin itself runs no local programs, writes no files, and installs no dependencies. Queries are sent to remote services through the ZCode gateway; the plugin contains neither direct vendor endpoints nor credentials.

Existing financial workflow plugins retain their own MCP declarations. Enabling them alongside this plugin may expose the same data source under different plugin namespaces; enable plugins as needed.
