# Add OmniCore Session Projection and Heartbeat Notes

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows the requirements in `/.agents/PLANS.md` from the repository root and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, OmniCore will maintain a session projection table that lets a UI list and archive chat sessions without scanning the entire event log. A lightweight `heartbeat.md` file will also exist at the repository root so different people can capture their own heartbeat intentions in a shared place.

## Progress

- [x] (2026-02-15 19:20Z) Added SQLite migrations for the `sessions` projection table.
- [x] (2026-02-15 19:24Z) Implemented `SessionStore` projection logic and kernel integration.
- [x] (2026-02-15 19:28Z) Added CLI helpers to list and archive sessions.
- [x] (2026-02-15 19:30Z) Added `heartbeat.md` and updated README.
- [x] (2026-02-15 19:36Z) Ran required migrations and type checks (root `check-types` failed as expected due to missing `packageManager`).

## Surprises & Discoveries

- Observation: root `pnpm run check-types` fails because `packageManager` is missing from the root `package.json`.
  Evidence: turbo error `Missing packageManager field` during `check-types`.

## Decision Log

- Decision: Store sessions as a projection table updated from the event log, not as a source-of-truth table.
  Rationale: Keeps the event log authoritative and allows replays to rebuild session listings.
  Date/Author: 2026-02-15 / Codex

- Decision: Use a lightweight `heartbeat.md` file in repo root for per-person heartbeat notes.
  Rationale: Matches the requested human-editable workflow without changing runtime behavior.
  Date/Author: 2026-02-15 / Codex

## Outcomes & Retrospective

Session projection is in place, and CLI tooling can list and archive sessions. A shared `heartbeat.md` exists for per-person heartbeat notes. Required commands were run, with the known root `check-types` failure recorded.

## Context and Orientation

OmniCore lives in `packages/omnicore`. Events are stored in the SQLite `events` table and appended in `packages/omnicore/src/event-store.ts`. The kernel (`packages/omnicore/src/kernel.ts`) records events and updates projections through `ProjectionStore`. This change adds a new `sessions` projection table and a `SessionStore` helper that keeps it up to date.

“Session” means a single AI chat thread. The projection table is a fast, derived view for listing sessions and marking them archived. The event log remains the source of truth.

## Plan of Work

Add a new migration to create the `sessions` projection table and indexes. Implement a `SessionStore` class that updates this projection on every event and tracks its own cursor in the `projections` table. Wire it into the kernel’s `recordEvent` path and ensure historical events are replayed into the projection on startup. Add CLI commands to list sessions and archive a session by writing a `session.archived` event. Create `heartbeat.md` at repo root with a short template for per-person heartbeat intentions. Update README to mention new CLI commands.

## Concrete Steps

Work from the repo root (`/Users/wibus/dev/bbot`).

1. Add the `sessions` projection migration and `SessionStore` code.
2. Wire session projection updates into the kernel and expose CLI commands.
3. Create `heartbeat.md` with a short template.
4. Run required commands:

   - `pnpm run db:generate`
   - `pnpm run workflow:dbml`
   - `pnpm run db:migrate`
   - `pnpm --filter @bbot/omnicore check-types`
   - `pnpm run check-types` (expected to fail due to missing root `packageManager` field)

## Validation and Acceptance

1. Start the kernel and adapter:

   - `pnpm --filter @bbot/omnicore dev:kernel`
   - `pnpm --filter @bbot/omnicore dev:adapter`

2. In another terminal, list sessions and archive one:

   - `pnpm --filter @bbot/omnicore exec tsx src/cli.ts sessions`
   - `pnpm --filter @bbot/omnicore exec tsx src/cli.ts session-archive <sessionId>`

Expected:

- `sessions` prints the active session IDs and timestamps.
- `session-archive` marks a session as archived, and `sessions --status archived` shows it.

## Idempotence and Recovery

The migration is additive and safe to re-run. If a mistake is found, run the down migration to drop the `sessions` table and remove the projection cursor, then re-run the up migration.

## Artifacts and Notes

Capture any relevant command outputs or example listings here during final verification.

## Interfaces and Dependencies

The session projection must provide:

    class SessionStore {
      loadCursor(): number;
      saveCursor(cursor: number): void;
      applyEvent(event: Event, seq: number): void;
      listSessions(options?: { status?: "active" | "archived"; limit?: number; offset?: number }): SessionRecord[];
    }
