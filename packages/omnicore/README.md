# OmniCore (v1)

Minimal AI-native kernel that is event-sourced, channel-agnostic, and self-restarting.

## What This Gives You

- Kernel is channel-agnostic (no Telegram/Discord fields).
- Events are the only source of truth (stored in SQLite).
- Channels are hot-pluggable WebSocket adapters (any language).
- Traits stay inside the kernel (heartbeat + sandbox).
- Heartbeat keeps the agent alive without any bot.
- Self-restart is automatic via the supervisor.

## Quick Start (Dev)

From repo root:

```bash
pnpm --filter @bbot/omnicore dev:supervisor
```

In another terminal, run the local CLI adapter:

```bash
pnpm --filter @bbot/omnicore dev:adapter
```

Type messages in the adapter terminal to talk to the kernel.

To bypass the supervisor and run the kernel directly:

```bash
pnpm --filter @bbot/omnicore dev:kernel
```

## Supervisor Commands

```bash
pnpm --filter @bbot/omnicore status
pnpm --filter @bbot/omnicore restart
```

## Build + Run (Prod-ish)

```bash
pnpm --filter @bbot/omnicore build
pnpm --filter @bbot/omnicore supervisor
```

## Adapter Protocol (JSON over WebSocket)

Adapters connect to `ws://localhost:<port>` and exchange JSON:

```json
{"type":"hello","adapterId":"cli","capabilities":["send_message","event_in"]}
{"type":"event","event":{"type":"signal.inbound","actorId":"cli:local","traceId":"...","payload":{"kind":"message","text":"hi"}}}
{"type":"action","action":{"type":"send_message","actorId":"cli:local","text":"hello"},"traceId":"..."}
```

## SQLite Storage

By default, OmniCore writes to `.omnicore/omnicore.db` in the current working directory.

To reset state:

```bash
rm -rf .omnicore
```

## Configuration (Stored in SQLite)

All runtime configuration (heartbeat, model provider/model, secrets) is stored in SQLite.
Use CLI commands to update configuration:

```bash
pnpm --filter @bbot/omnicore dev:config -- set-model openai gpt-4o-mini
pnpm --filter @bbot/omnicore dev:config -- set-secret llm.apiKey <token>
```

Agent instructions are loaded from `AGENTS.md` at the repo root. Edit that file to change the kernel's guidance.

## Environment Variables

Only used to locate the SQLite database and runtime environment:

- `OMNICORE_ROOT` — base path for defaults (DB path). Defaults to `INIT_CWD` or `process.cwd()`.
- `OMNICORE_DATA_DIR` — override data directory
- `OMNICORE_DB_PATH` — override SQLite DB path
- `OMNICORE_SANDBOX_ROOT` — sandbox root path
- `OMNICORE_ADAPTER_PORT` — WebSocket adapter port (default: `8787`)
- `OMNICORE_KERNEL_CMD` — supervisor kernel command (default: `node`)
- `OMNICORE_KERNEL_ARGS` — supervisor kernel args (default: `dist/cli.js kernel`)
- `OMNICORE_KERNEL_CWD` — supervisor kernel working directory

## Notes

- This is a fresh package and does not depend on existing BBot core modules.
- LLM reasoning uses `@bbot/agent` (pi-ai) when a model is configured in SQLite.
- Memory is file-based (AGENTS.md + MEMORY.md) and not yet wired into the kernel.
