---
name: project-overview
description: Complete project architecture and structure guide. Use when exploring the codebase, understanding project organization, finding files, or needing comprehensive architectural context. Triggers on architecture questions, directory navigation, or project overview needs.
---

# BBot Project Overview

BBot is a pnpm monorepo for a self-bootstrapping AI coding agent and its runtime kernel. The repo is organized to keep the agent runtime, the kernel, and adapters separate but composable.

## Repo Layout

- `apps/`: runnable applications (currently `apps/bot-telegram`).
- `packages/`: core libraries and runtimes.
- `docs/`: design notes, exec plans, runbooks, and PRD/roadmaps.
- `infra/`: infrastructure scripts/config.
- `tooling/`: shared tooling config.
- `tests/`: tests and fixtures.
- `memory/`: daily memory logs.
- Root identity/policy files: `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`, `HEARTBEAT.md`, `CLAUDE.md`.

## Key Packages

- `packages/agent`: LLM runtime and tool execution. Owns system prompt building, skills, compaction, MCP, and tool wiring.
- `packages/omnicore`: AI-native kernel with event sourcing, adapters, sessions, and supervisor.
- `packages/shared`: shared utilities (`env/`, `logger.ts`, `paths.ts`, `restart.ts`).

## OmniCore Structure (Layered)

- `packages/omnicore/src/domain`: contracts and event types (`domain/events.ts`, `domain/adapter-protocol.ts`).
- `packages/omnicore/src/infra`: SQLite stores, migrations, projections, conversation context (`infra/*.ts`).
- `packages/omnicore/src/runtime`: kernel orchestration, reasoner, traits (`runtime/kernel.ts`, `runtime/reasoner.ts`, `runtime/traits/*`).
- `packages/omnicore/src/transport`: WebSocket adapter hub (`transport/adapter-hub.ts`).
- `packages/omnicore/src/sdk`: adapter client for external adapters (`sdk/adapter-client.ts`).
- `packages/omnicore/src/entry`: CLI, supervisor, local CLI adapter (`entry/cli.ts`, `entry/supervisor.ts`, `entry/cli-adapter.ts`).

## Agent Package Structure

- `packages/agent/src/system-prompt.ts`: system prompt assembly and usage stats.
- `packages/agent/src/skills.ts`: skill discovery + prompt formatting.
- `packages/agent/src/tools/`: built-in tools wiring.
- `packages/agent/src/mcp/`: MCP tool integration.
- `packages/agent/src/compaction/`: context compaction prompts + logic.

## Apps

- `apps/bot-telegram`: Telegram adapter app that connects to OmniCore over WebSocket.

## Data and Runtime

- OmniCore stores data in `.omnicore/omnicore.db` (SQLite event log, config, projections).
- Sessions read `AGENTS.md` from the session root path.

## Navigation Tips

- Start with `packages/omnicore/README.md` for runtime usage.
- `packages/agent/src/index.ts` shows how system prompt + tools + skills are wired.
