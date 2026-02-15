# OmniCore (v1)

Minimal AI-native kernel that is event-sourced, trait-driven, and self-restarting.

## What This Gives You

- Kernel is channel-agnostic (no Telegram/Discord fields).
- Events are the only source of truth (stored in SQLite).
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

## SQLite Storage

By default, OmniCore writes to `.omnicore/omnicore.db` in the current working directory.

To reset state:

```bash
rm -rf .omnicore
```

## Configuration (Stored in SQLite)

All runtime configuration (heartbeat, mission, model provider/model) is stored in SQLite.
Use CLI commands to update configuration:

```bash
pnpm --filter @bbot/omnicore dev:config -- set-model openai gpt-4o-mini
pnpm --filter @bbot/omnicore dev:config -- set-secret discord.token <token>
```

Agent instructions are loaded from `AGENTS.md` at the repo root. Edit that file to change the kernel's guidance.

## Environment Variables

Only used to locate the SQLite database and runtime environment:

- `OMNICORE_ROOT` — base path for defaults (DB path). Defaults to `INIT_CWD` or `process.cwd()`.
- `OMNICORE_DATA_DIR` — override data directory
- `OMNICORE_DB_PATH` — override SQLite DB path
- `OMNICORE_SANDBOX_ROOT` — sandbox root path
- `OMNICORE_KERNEL_CMD` — supervisor kernel command (default: `node`)
- `OMNICORE_KERNEL_ARGS` — supervisor kernel args (default: `dist/cli.js kernel`)
- `OMNICORE_KERNEL_CWD` — supervisor kernel working directory

## Notes

- This is a fresh package and does not depend on existing BBot core modules.
- LLM reasoning uses `@mariozechner/pi-ai` when a model is configured in SQLite.
- The CLI channel is just a minimal default trait; other traits can be added later.
