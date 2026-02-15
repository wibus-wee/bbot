# Replace OmniCore v0 File Storage With SQLite (No ORM)

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

PLANS.md is located at `/Users/wibus/dev/bbot/.agents/PLANS.md`. This document must be maintained in accordance with it.

## Purpose / Big Picture

The goal is to move OmniCore’s persistence from file-based JSON/JSONL to a single SQLite database while keeping the kernel channel-agnostic and event-sourced. After this change, events, kernel configuration, secrets, and memory all live in SQLite. The kernel no longer reads provider or model configuration from environment variables, and instead loads these settings from the database. The migration system uses explicit up/down SQL files to enable future evolution without data migration requirements today. The working behavior is demonstrated by running the kernel and observing that it creates and uses the SQLite database without writing event/state files.

## Progress

- [x] (2026-02-15 02:05Z) Created ExecPlan for SQLite refactor and migration system.
- [x] (2026-02-15 02:20Z) Added SQLite dependency and implemented minimal DB wrapper with PRAGMAs.
- [x] (2026-02-15 02:25Z) Created migrations folder with `001_init.up.sql` and `001_init.down.sql`.
- [x] (2026-02-15 02:30Z) Implemented migration runner with up tracking via `schema_migrations`.
- [x] (2026-02-15 02:40Z) Replaced JSONL event log with SQLite-backed event store.
- [x] (2026-02-15 02:45Z) Replaced file-based context/memory with SQLite `kv_store`.
- [x] (2026-02-15 02:50Z) Moved kernel config (heartbeat, mission, model provider/name) into SQLite.
- [x] (2026-02-15 02:55Z) Updated kernel and traits to read secrets from SQLite.
- [x] (2026-02-15 03:00Z) Updated README and removed file-based persistence references.
- [x] (2026-02-15 02:55Z) Ran `pnpm --filter @bbot/omnicore check-types`.
- [x] (2026-02-15 03:05Z) Updated ExecPlan with actual progress, discoveries, and decisions as work completes.

## Surprises & Discoveries

- Observation: `pnpm run check-types` failed because Turbo could not resolve workspaces (reported missing `packageManager` field).
  Evidence: Turbo output `Could not resolve workspaces. -> Missing packageManager field in package.json`.

## Decision Log

- Decision: Use SQLite with direct SQL (no ORM) for both event storage and configuration.
  Rationale: Keeps event sourcing append-only and avoids ORM state coupling.
  Date/Author: 2026-02-15 (assistant)
- Decision: Agent instructions come from `AGENTS.md`, not the database.
  Rationale: Aligns with the user’s intent that mission is internalized in the agent’s canonical instructions file.
  Date/Author: 2026-02-15 (assistant)

## Outcomes & Retrospective

OmniCore now persists events, configuration, secrets, and memory in SQLite with a migration system using explicit up/down SQL files. Environment variables are limited to locating the database and runtime paths. Agent instructions are read from `AGENTS.md` instead of being stored in the database. The kernel and supervisor both initialize SQLite and run migrations before operating.

## Context and Orientation

OmniCore currently stores events in JSONL files and stores memory/context in JSON files. The kernel also reads runtime configuration via environment variables. The new design replaces all persistence with a single SQLite database, accessed with direct SQL (no ORM). Migrations are stored inside `packages/omnicore/migrations/` with explicit `*.up.sql` and `*.down.sql` files. The kernel will create/open the SQLite database on startup, apply migrations, and use it for event append/query, configuration reads, secrets, and memory.

Key files in the new design:

- `packages/omnicore/src/db.ts`: SQLite connection and helper functions.
- `packages/omnicore/src/migrations.ts`: migration runner and migration registry.
- `packages/omnicore/migrations/001_init.up.sql`: initial schema.
- `packages/omnicore/migrations/001_init.down.sql`: rollback schema.
- `packages/omnicore/src/event-store.ts`: event append/query/tail against SQLite.
- `packages/omnicore/src/kv-store.ts`: key/value store for memory and LLM context.
- `packages/omnicore/src/config-store.ts`: kernel configuration and secret storage.

## Plan of Work

First, introduce a minimal SQLite dependency (`better-sqlite3`) and a DB wrapper that opens the database path, configures PRAGMAs, and exposes an `execute`/`query` API. Next, add migrations folder with a `schema_migrations` table plus core tables: `events`, `kernel_config`, `secrets`, and `kv_store`. Implement a migration runner that applies `*.up.sql` in order and records them; include `*.down.sql` for future rollbacks. Then replace the JSONL event log with a SQLite event store that inserts events and allows polling by sequence number for the supervisor. Replace file-based memory and LLM context with the `kv_store` table. Move heartbeat interval, mission text, and model provider/name into `kernel_config`, and update the kernel to read them from SQLite on startup. Replace environment variable configuration with DB values (environment variables only point to the DB path). Finally, update README and run type checks.

## Concrete Steps

1. Add `better-sqlite3` dependency to `packages/omnicore/package.json`.
2. Create `packages/omnicore/src/db.ts` with a minimal SQLite wrapper and PRAGMAs.
3. Add `packages/omnicore/migrations/001_init.up.sql` and `001_init.down.sql`.
4. Implement `packages/omnicore/src/migrations.ts` to run pending migrations.
5. Replace `src/event-log.ts` with `src/event-store.ts` (SQLite).
6. Add `src/kv-store.ts` and `src/config-store.ts` for memory/config/secrets.
7. Update kernel to call migrations, use SQLite stores, and load config from DB.
8. Update traits (CLI, Discord if present) to use secrets from DB instead of files.
9. Update README to describe SQLite usage and the single env var `OMNICORE_DB_PATH`.
10. Run `pnpm --filter @bbot/omnicore check-types`.
11. Update Progress, Decision Log, and Outcomes.

## Validation and Acceptance

- Running `pnpm --filter @bbot/omnicore dev:kernel` creates a SQLite DB at the default location and no longer writes JSON/JSONL state files.
- A heartbeat event is persisted in the `events` table.
- Setting provider/model via CLI or direct SQL updates `kernel_config`, and the kernel reads it on startup.
- `pnpm --filter @bbot/omnicore check-types` succeeds.

## Idempotence and Recovery

Migrations are idempotent; re-running the kernel should not re-apply the same migration. If a migration fails, delete the SQLite file for a clean start (acceptable for now since no data migration is required).

## Artifacts and Notes

Expected tables after `001_init.up.sql`:

    events
    kernel_config
    secrets
    kv_store
    schema_migrations

## Interfaces and Dependencies

- Dependency: `better-sqlite3`.
- Event store interface:

    append(event: Event): void
    readRecent(limit: number): Event[]
    tail(onEvent, options): () => void

- Config store interface:

    getKernelConfig(): { heartbeatMs: number; missionText: string; modelProvider?: string; modelName?: string }
    setKernelConfig(...)
    getSecret(key: string): string | null
    setSecret(key: string, value: string): void

- KV store interface:

    get(key: string): string | null
    set(key: string, value: string): void

Note: Update this plan as implementation proceeds, including progress timestamps and any changes in design decisions.
