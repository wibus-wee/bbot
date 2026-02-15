# Add Session Root Path and Locking

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows the requirements in `/.agents/PLANS.md` from the repository root and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, each OmniCore session will have a configurable `rootPath` that determines where the kernel reads `AGENTS.md`, `HEARTBEAT.md`, `MISSION.md`, and `MEMORY.md`, and where the agent runs tools. The root path can be set before the first LLM call and becomes locked once a session has started. This allows multiple sessions to operate in different directories without losing self-driven behavior.

## Progress

- [x] (2026-02-15 21:10Z) Drafted implementation plan for session root path and lock semantics.
- [x] (2026-02-15 21:24Z) Added session projection columns for `root_path` and `first_llm_seq` with migrations.
- [x] (2026-02-15 21:31Z) Added `session.root.set` and `agent.run.start` events and wired projection updates.
- [x] (2026-02-15 21:40Z) Updated kernel to resolve per-session root path, lock after first LLM, and read instructions from session root.
- [x] (2026-02-15 21:45Z) Added CLI command `session-root` with absolute path normalization and lock checks.
- [x] (2026-02-15 21:50Z) Updated README and ran required checks/migrations.

## Surprises & Discoveries

- Observation: root `pnpm run check-types` fails because `packageManager` is missing from the root `package.json`.
  Evidence: turbo error `Missing packageManager field` during `check-types`.

## Decision Log

- Decision: Lock `rootPath` once `agent.run.start` is recorded for a session.
  Rationale: Ensures the working directory is immutable after the first LLM call.
  Date/Author: 2026-02-15 / Codex

- Decision: Normalize `rootPath` to absolute paths in the kernel and CLI.
  Rationale: Avoids ambiguity across adapters and shells.
  Date/Author: 2026-02-15 / Codex

## Outcomes & Retrospective

Sessions now have a configurable root path that locks after the first LLM call. The kernel reads instructions and runs tools from the session root, and the CLI can set the root path before the session starts. Required checks were run with the known root `check-types` failure recorded.

## Context and Orientation

OmniCore stores events in SQLite (`packages/omnicore/src/event-store.ts`) and keeps a derived sessions projection (`packages/omnicore/src/session-store.ts`). The kernel reads instructions from `AGENTS.md` using `packages/omnicore/src/kernel.ts`, and CLI commands live in `packages/omnicore/src/cli.ts`. This change adds session-level root paths that define where the agent reads its mission files and runs tools.

## Plan of Work

Add new columns to the `sessions` projection table for `root_path`, `first_llm_seq`, and `first_llm_at`. Introduce `session.root.set` events for setting the root path and `agent.run.start` events to lock it. Update the session projection to track root path and the first LLM call. Update the kernel to resolve the session root path (fallback to kernel root), record `agent.run.start` before the first LLM call, and read instructions from the session root. Add a CLI command to set the root path with absolute path normalization and lock enforcement. Update README and run required checks.

## Concrete Steps

Work from the repo root (`/Users/wibus/dev/bbot`).

1. Add migration `008_sessions_root_path` with up/down SQL.
2. Update `events.ts` with `session.root.set` and `agent.run.start`.
3. Update `session-store.ts` to track root path and first LLM sequence.
4. Update `kernel.ts` to resolve per-session root and lock changes after first LLM call.
5. Add `session-root` CLI command and update README.
6. Run required commands:

   - `pnpm run db:generate`
   - `pnpm run workflow:dbml`
   - `pnpm run db:migrate`
   - `pnpm --filter @bbot/omnicore check-types`
   - `pnpm run check-types` (expected to fail due to missing root `packageManager` field)

## Validation and Acceptance

1. Create a session and set its root path before sending any messages.
2. Send a message to the session and verify the root path is locked.
3. Attempt to change root path after the first LLM call and confirm it is rejected.

Expected behavior:

- `session-root` succeeds before first LLM call and stores an absolute path.
- After the first LLM call, `session-root` refuses to change the path.

## Idempotence and Recovery

The migration is additive and safe to re-run. If changes are incorrect, apply the down migration to drop the added columns and re-run the up migration.

## Artifacts and Notes

Capture any relevant command outputs or logs here during final verification.

## Interfaces and Dependencies

Events must include `session.root.set` and `agent.run.start`, and the sessions projection must store `root_path`, `first_llm_seq`, and `first_llm_at` with updates derived from those events.
