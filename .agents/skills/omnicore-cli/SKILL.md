---
name: omnicore-cli
description: OmniCore CLI usage via `bbot <command>` for starting kernel/supervisor, checking status, managing sessions, and updating config/secrets. Use when running or documenting OmniCore CLI commands or when CLI flags/behavior change.
---

# OmniCore CLI

## Overview
Run OmniCore CLI commands. Source code you can find in `@bbot/omnicore` src/cli.ts.

## Command Format
- Base command:

```bash
bbot <command> [args...]
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
bbot status
bbot sessions --status archived --limit 50
bbot session-root session:abc /path/to/root
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
bbot config set-model openai gpt-4o-mini
bbot config set-base-url https://api.openai.com/v1
bbot config set-thinking medium
bbot config set-secret llm.apiKey --prompt
```

## Update Policy
- If the CLI command set, flags, or behavior changes, update this skill and the `SKILLS` file in the same change.
