# OmniCore (v0)

Minimal AI-native kernel that is event-sourced, trait-driven, and self-restarting.

## What This Gives You

- Kernel is channel-agnostic (no Telegram/Discord fields).
- Events are the only source of truth (JSONL event log).
- Traits are pluggable adapters (CLI channel, heartbeat, sandbox, memory).
- Heartbeat keeps the agent alive without any bot.
- Self-restart is automatic via the supervisor.

## Quick Start (Dev)

From repo root:

```bash
pnpm --filter @bbot/omnicore dev:supervisor
```

In another terminal, run the kernel directly if you want to bypass the supervisor:

```bash
pnpm --filter @bbot/omnicore dev:kernel
```

Type messages in the terminal. Use these commands:

- `!restart` — request a self-restart
- `!bash <cmd>` — run a bash command in the sandbox
- `!read <path>` — read a file in the sandbox
- `!write <path> :: <content>` — write a file in the sandbox

## Build + Run (Prod-ish)

```bash
pnpm --filter @bbot/omnicore build
pnpm --filter @bbot/omnicore supervisor
```

## Data Directory

By default, OmniCore writes to `.omnicore/` in the current working directory:

- `.omnicore/events.log` (append-only event log)
- `.omnicore/views/context.json` (materialized view)
- `.omnicore/views/llm-context.json` (LLM context view)
- `.omnicore/memory.json` (memory trait store)

To reset state:

```bash
rm -rf .omnicore
```

## Environment Variables

- `OMNICORE_DATA_DIR` — override data directory
- `OMNICORE_MISSION_PATH` — override mission file path
- `OMNICORE_HEARTBEAT_MS` — heartbeat interval (ms)
- `OMNICORE_SANDBOX_ROOT` — sandbox root path
- `OMNICORE_MODEL` — enable LLM reasoning (e.g. `openai:gpt-4o-mini`)
- `OMNICORE_KERNEL_CMD` — supervisor kernel command (default: `node`)
- `OMNICORE_KERNEL_ARGS` — supervisor kernel args (default: `dist/cli.js kernel`)
- `OMNICORE_KERNEL_CWD` — supervisor kernel working directory
- `OMNICORE_ROOT` — base path for defaults (data dir, mission, token path). Defaults to `INIT_CWD` or `process.cwd()`.

## Notes

- This is a fresh package and does not depend on existing BBot core modules.
- LLM reasoning uses `@mariozechner/pi-ai` when `OMNICORE_MODEL` is set.
- The CLI channel is just a minimal default trait; other traits can be added later.
