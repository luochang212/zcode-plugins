# zcode-context

[中文文档](./README_CN.md)

A read-only, offline ZCode UI plugin that shows what every request carried: session usage, model input composition, per-step differences, and compaction events, in a session side pane.

- **Read-only** — it never writes to ZCode data, never changes settings, and never calls a model.
- **Offline** — it makes no network requests. It only reads what ZCode already records on your machine.
- **Live** — the panel updates with the session: injections, compactions, and model switches appear as they happen.

## What it shows

| View | Question it answers |
| --- | --- |
| Request overview | Why is the context so large? Size of each request, composition by category (system prompt, tool definitions, user messages, assistant messages, tool results), and the trend across steps. |
| Composition & trend | Which kind of content takes the most room, and where it entered the conversation. |
| Request diff | What changed between two steps — what was added, what was removed (useful before/after compaction). |
| Context events | Runtime injections, compactions (including what was summarized away), and model switches, read from the session store. |

Clicking an event opens the exact item it brought into the context; a compaction expands **what was summarized**.

## Requirements

- ZCode Desktop 3.15.1+ (session side pane / MCP Apps support).
- Node.js 24+ available for the bundled MCP server (`node` on `PATH`).
- ZCode CLI local data under `~/.zcode/cli` (the default), or a custom data root (see Configuration).

## Install

Install from the ZCode plugin marketplace, then enable **zcode-context**. A **Context** side pane becomes available for sessions in local workspaces.

## Components

- **MCP server** (`context`, stdio): exposes the read-only inspection tools `get_context_summary` and `get_context_request`, and serves the panel page over `ui://zcode-context/panel.html`.
- **UI surface** (`context`, availability `session`): the side pane.

## Configuration

| Option | Description | Default |
| --- | --- | --- |
| `dataRoot` | Directory containing `db/`, `rollout/` and `log/`. Empty uses `~/.zcode/cli`. | empty |
| `dbPath` | Optional absolute path to the session database. | empty |

## How it works and privacy

The plugin reads ZCode CLI's local records only — the session database (`db/db.sqlite`), rollout files, and logs — and derives usage, composition, differences, and events from them. It sends nothing anywhere: no telemetry, no network access, no model calls. All processing happens on your machine, in the plugin process.

## Dependencies and side effects

- Runtime dependencies (`@modelcontextprotocol/sdk`, `zod`) are bundled at build time; license notices are generated into `dist/THIRD_PARTY_NOTICES.txt`.
- No network access, no file writes outside its own process memory, no hooks, no commands.
- Reads: `~/.zcode/cli/db/`, `~/.zcode/cli/rollout/`, `~/.zcode/cli/log/` (or the configured data root).

## Development

Source lives in [`ui-plugins/zcode-context/`](../../ui-plugins/zcode-context). Build with `pnpm install` and `pnpm build` from the repository root; tests run with `node --test test/*.test.mjs`. Upstream project: <https://github.com/Kevinzzz6/zcode-context>.

## License

[MIT](./LICENSE)
