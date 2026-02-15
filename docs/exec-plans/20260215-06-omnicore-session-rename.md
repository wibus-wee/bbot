# Add Session Rename Events and Projection Rebuild

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows the requirements in `/.agents/PLANS.md` from the repository root and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, OmniCore will support renaming chat sessions via an event (`session.renamed`), and it will expose a CLI command to rebuild the session projection from the event log. This makes session listings editable and ensures projections can be regenerated when needed.

## Progress

- [x] (2026-02-15 20:05Z) Added `session.renamed` event type and projection handling.
- [x] (2026-02-15 20:10Z) Added CLI commands for rename and projection rebuild.
- [x] (2026-02-15 20:14Z) Ran type checks (root `check-types` failed as expected due to missing `packageManager`).

## Surprises & Discoveries

- Observation: root `pnpm run check-types` fails because `packageManager` is missing from the root `package.json`.
  Evidence: turbo error `Missing packageManager field` during `check-types`.

## Decision Log

- Decision: Represent session title changes as explicit `session.renamed` events.
  Rationale: Keeps the event log authoritative and allows title history to be replayed.
  Date/Author: 2026-02-15 / Codex

- Decision: Provide `sessions-rebuild` CLI command that clears and rebuilds the projection from the event log.
  Rationale: Gives an explicit recovery path if the projection drifts or is corrupted.
  Date/Author: 2026-02-15 / Codex

## Outcomes & Retrospective

Session rename events and projection rebuild tooling are in place, with CLI commands documented. Type checks were run with the known root failure recorded.

## Context and Orientation

OmniCore events are defined in `packages/omnicore/src/events.ts` and recorded by the kernel (`packages/omnicore/src/kernel.ts`). The session listing is a projection in SQLite managed by `packages/omnicore/src/session-store.ts`, and CLI commands live in `packages/omnicore/src/cli.ts`.

## Plan of Work

Add a `session.renamed` event type and update the session projection logic to treat it like `session.created` for title updates. Extend the CLI to emit rename events and to rebuild the session projection by replaying all events. Update README to document the new commands.

## Concrete Steps

Work from the repo root (`/Users/wibus/dev/bbot`).

1. Update event types and projection logic.
2. Add CLI commands `session-rename` and `sessions-rebuild`.
3. Update README with new commands.
4. Run required commands:

   - `pnpm --filter @bbot/omnicore check-types`
   - `pnpm run check-types` (expected to fail due to missing root `packageManager` field)

## Validation and Acceptance

1. Run `pnpm --filter @bbot/omnicore exec tsx src/cli.ts session-rename <sessionId> "My title"`.
2. Run `pnpm --filter @bbot/omnicore exec tsx src/cli.ts sessions` and verify the title is shown.
3. Run `pnpm --filter @bbot/omnicore exec tsx src/cli.ts sessions-rebuild` and verify the listing remains consistent.

## Idempotence and Recovery

`sessions-rebuild` clears the sessions projection and repopulates it from the event log, so it can be safely re-run.

## Artifacts and Notes

Capture any relevant command output here during final verification.

## Interfaces and Dependencies

Events must include the new `session.renamed` type, and `SessionStore.applyEvent` must update the title when it sees that event.
