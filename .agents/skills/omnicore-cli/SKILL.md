---
name: omnicore-cli
description: OmniCore CLI usage via `pnpm --filter @bbot/omnicore exec tsx src/cli.ts <command>` for starting kernel/supervisor, checking status, managing sessions, and updating config/secrets. Use when running or documenting OmniCore CLI commands or when CLI flags/behavior change.
---

# OmniCore CLI

## Overview
Run OmniCore CLI commands from the repo root using the `tsx` entrypoint and the pnpm filter.

## Command Format
- Always run from the workspace root.
- Base command:

```bash
pnpm --filter @bbot/omnicore exec tsx src/cli.ts <command> [args...]
```

## Core Commands
- `kernel`: Start the kernel.
- `supervisor`: Start the supervisor (spawns the kernel).
- `status`: Show kernel status from the event log.
- `restart`: Request a kernel restart via event.
- `sessions`: List sessions.
- `session-archive <sessionId>`: Archive a session.
- `session-rename <sessionId> <title>`: Rename a session.
- `session-root <sessionId> <path>`: Set session root path (only before first LLM call).
- `sessions-rebuild`: Rebuild sessions projection from the event log.

Examples:

```bash
pnpm --filter @bbot/omnicore exec tsx src/cli.ts status
pnpm --filter @bbot/omnicore exec tsx src/cli.ts sessions --status archived --limit 50
pnpm --filter @bbot/omnicore exec tsx src/cli.ts session-root session:abc /path/to/root
```

## Config Commands
- `config`: Interactive wizard (TTY required).
- `config wizard`: Same as `config`.
- `config show`: Print current kernel config (JSON).
- `config set-model <provider> <model>`
- `config set-base-url <url>`
- `config set-thinking <off|minimal|low|medium|high|xhigh>`
- `config set-compaction-enabled <true|false|1|0|yes|no>`
- `config set-compaction-reserve <tokens>`
- `config set-compaction-keep <tokens>`
- `config set-auto-compact <number|off>`
- `config set-secret <key> <value>` or `config set-secret <key> --prompt`

Examples:

```bash
pnpm --filter @bbot/omnicore exec tsx src/cli.ts config set-model openai gpt-4o-mini
pnpm --filter @bbot/omnicore exec tsx src/cli.ts config set-base-url https://api.openai.com/v1
pnpm --filter @bbot/omnicore exec tsx src/cli.ts config set-thinking medium
pnpm --filter @bbot/omnicore exec tsx src/cli.ts config set-secret llm.apiKey --prompt
```

## Update Policy
- If the CLI command set, flags, or behavior changes, update this skill and the `SKILLS` file in the same change.
