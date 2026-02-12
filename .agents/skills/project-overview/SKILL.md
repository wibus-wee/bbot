---
name: project-overview
description: Complete project architecture and structure guide. Use when exploring the codebase, understanding project organization, finding files, or needing comprehensive architectural context. Triggers on architecture questions, directory navigation, or project overview needs.
---

# BBot Project Overview


## Project Description

AI Agent-first, multi-interface development workspace powered by **pi-mono**.

The system is designed around a **core-first architecture**:

> Core Daemon manages everything.  
> All other interfaces are thin transports.

## Architecture Philosophy

| Principle | Description |
|------------|------------|
| Core-first | Single source of truth in `core-daemon` |
| Agent-native | Built on pi-mono runtime (`@mariozechner/*`) |
| Multi-interface | Telegram, WebUI, TUI share the same backend |
| Behavior-driven | BDD defines observable system behavior |
| Transport-agnostic | All clients talk through SDK |
| Monorepo modularity | Strict package boundaries |


## Complete Tech Stack

| Category | Technology |
|------------|------------|
| Monorepo | pnpm workspace + Turborepo |
| Language | TypeScript |
| Agent Runtime | pi-mono (`@mariozechner/pi-ai`, etc.) |
| Backend | Node.js |
| HTTP | Fastify |
| Telegram Bot Framework | grammY |
| Web UI | React + Vite + Tanstack Router |
| TUI | Ink (Node) |
| Validation | zod |
| Storage | PostgreSQL, optional Redis |
| Testing | Cucumber (BDD) + Vitest |

## Complete Project Structure

Monorepo using strict layering boundaries.

```
repo/
  turbo.json
  pnpm-workspace.yaml
  package.json
  tsconfig.base.json
  .editorconfig
  .gitignore
  tooling/
    eslint/                # shared ESLint config
    tsconfig/              # tsconfig presets (node/bun/react/lib)
    scripts/               # release/gen/dev scripts
  apps/
    core-daemon/           # core orchestrator daemon (Node). Source of truth.
    bot-telegram/          # Telegram bot (Node + grammY). Thin adapter only.
    webui/                # remote Web UI (React/Vite or Next)
    tui/                   # TUI (Node). Thin adapter only.
  packages/
    agent/                       # Agent 系统
    domain/                # pure domain model + state machine (no IO)
    core/                  # application layer (use-cases): commands/queries
    sdk/                   # clients for all frontends (HTTP/WS)
    adapters/              # external system implementations
    protocol/              # stable DTO/events/schema boundary
    testkit/               # BDD assets shared across apps
    ui-kit/                # optional shared UI components
    shared/                # small shared utils (keep it small)
  infra/                   # deployment/runtime (optional)
    docker/
    k8s/
    terraform/
    cloudflare/
  docs/
    prd/
    api/
    runbooks/
  tests/                   # optional true E2E tests (Playwright, etc.)
    e2e/
    load/
```


## Architecture Map

| Layer | Location |
|--------|-----------|
| Transport Layer | `apps/*` |
| Core Orchestrator | `apps/core-daemon` |
| Application Logic | `packages/core` |
| Domain Model | `packages/domain` |
| Agent Runtime | `packages/agent` |
| External Integrations | `packages/adapters` |
| Protocol Boundary | `packages/protocol` |
| SDK | `packages/sdk` |
| Behavior Testing | `packages/testkit` |
| Shared Utilities | `packages/shared` |


## Agent Layer Breakdown

```

core-daemon
↓
packages/agent (pi-mono runtime)
↓
@ mariozechner/pi-ai
↓
LLM Providers (OpenAI / Anthropic / Google)
```

The agent is not pluggable.  
pi-mono is the single agent runtime foundation.

---

## Data Flow (Core Data Flow & Contract)

```

Telegram / WebUI / TUI
↓
SDK Client (generated from OpenAPI)
↓
Core Daemon HTTP API
↓
packages/core use-cases
↓
packages/agent (pi-mono runtime)
↓
packages/adapters (tools)
↓
Database (Run / RunEvent / ToolExecution / UserMessage)
↓
SSE + Query Endpoints
↓
UI Updates
```

Key constraints and boundaries:
1. The single authoritative path is "client → SDK → core-daemon → packages/core → agent/adapters → database → SSE/query → client". No entry point may bypass this path to write directly to the database.
2. MVP uses code-first: API schemas are defined at the core-daemon route layer, the OpenAPI plugin generates the spec and writes it to `packages/protocol`, then `packages/sdk` generates client code. The protocol artifacts are generated outputs, not a second source of truth.
3. Run lifecycle and event streams use the database as the final source of truth. SSE/query endpoints must only read persisted events, not assemble them from in-memory state.
4. apps/* are thin adapters; business logic and state changes must be centralized in `packages/core` and `packages/agent`.

## Behavior-Driven Architecture

BDD defines observable behavior.

Example:

```

Given a Demo Session exists
When user sends "deploy"
Then preview URL should be generated
And run state becomes "success"

```

All behavior must be testable without Telegram/WebUI.
