# Refactor OmniCore Structure Into Clear Layers

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan must be maintained in accordance with `/.agents/PLANS.md` from the repository root.

## Purpose / Big Picture

After this change, the OmniCore package will have a clear, layered structure that separates domain contracts, infrastructure (SQLite + projections), runtime orchestration, and entrypoints. External adapter developers will be able to find the protocol contract and SDK-style client without reading kernel internals. The behavior of the system should remain the same, and the change is verified by running the existing type-check command and confirming the CLI and adapter entrypoints still compile.

## Progress

- [x] (2026-02-16 00:20Z) Created ExecPlan and captured current structure goals.
- [x] (2026-02-16 00:38Z) Moved OmniCore source files into new layer folders and updated import paths.
- [x] (2026-02-16 00:42Z) Updated entrypoint scripts, README command references, and migration path assumptions.
- [x] (2026-02-16 00:48Z) Ran type checks; turbo crashed, fallback `pnpm --filter @bbot/omnicore check-types` succeeded.
- [x] (2026-02-16 00:50Z) Summarized outcomes and documented decisions and discoveries.

## Surprises & Discoveries

- Observation: Turbo crashed again while running `pnpm run check-types` and wrote a report at `/var/folders/c7/r4_0jrd91zg4n58001d0pl3r0000gn/T/report-a708d0a9-3d6c-444a-aae0-f009d0a2378a.toml`. The fallback `pnpm --filter @bbot/omnicore check-types` completed successfully.
  Evidence: `Oops! Turbo has crashed.` followed by a successful `tsc -p tsconfig.json --noEmit` run.

## Decision Log

- Decision: Use layered folders (`domain`, `infra`, `runtime`, `entry`, `sdk`, `transport`) rather than a single flat `src`.
  Rationale: Makes responsibility boundaries explicit and reduces the “everything is in core” ambiguity for external adapter developers.
  Date/Author: 2026-02-16, Codex

- Decision: Place the adapter protocol in `domain`, the WebSocket hub in `transport`, and the adapter client in `sdk`, and re-export the protocol from `src/index.ts`.
  Rationale: Clarifies that the protocol is a contract, the hub is runtime I/O, and the client is reusable for external adapters.
  Date/Author: 2026-02-16, Codex

- Decision: Update the default supervisor kernel args to `dist/entry/cli.js` to match the new entrypoint output path.
  Rationale: Keeps production/default supervisor startup aligned with the new build layout.
  Date/Author: 2026-02-16, Codex

## Outcomes & Retrospective

The OmniCore source tree is now layered into `domain`, `infra`, `runtime`, `transport`, `sdk`, and `entry`, with updated imports and scripts. No functional behavior was changed, but entrypoint paths and default kernel args were updated to reflect the new build output layout. Validation relied on the fallback `pnpm --filter @bbot/omnicore check-types` after turbo crashed, so the repo-wide `pnpm run check-types` remains flaky and should be revisited separately.

## Context and Orientation

OmniCore lives at `packages/omnicore`. Before this refactor, source files were mostly flat under `packages/omnicore/src` with `adapters/`, `traits/`, and `views/` subfolders. The kernel (`src/kernel.ts`) orchestrated event ingestion, persistence, LLM calls, and adapter routing. The adapter protocol and WebSocket hub were under `src/adapters`. Event storage and projections lived in `src/event-store.ts`, `src/session-store.ts`, and `src/projection-store.ts`. The CLI and supervisor entrypoints were `src/cli.ts` and `src/supervisor.ts`. Migrations were and remain outside `src` in `packages/omnicore/migrations`.

After this refactor, the layout is layered as follows:

- `packages/omnicore/src/domain`: events and adapter protocol contracts.
- `packages/omnicore/src/infra`: SQLite access, migrations, projections, and conversation context reconstruction.
- `packages/omnicore/src/runtime`: kernel orchestration, reasoner, and traits.
- `packages/omnicore/src/transport`: WebSocket adapter hub.
- `packages/omnicore/src/sdk`: reusable adapter client.
- `packages/omnicore/src/entry`: CLI, supervisor, and the dev CLI adapter.

Key terms used in this plan:

- Domain: Pure contracts and types (events and adapter protocol). No I/O, no SQLite.
- Infrastructure (infra): SQLite access, migrations, and projections. This layer writes and reads data but does not decide behavior.
- Runtime: Orchestration logic that interprets events and calls the LLM.
- Transport: WebSocket wiring used by runtime to talk to adapters.
- Entry: Executable entrypoints (CLI, supervisor, dev adapter).
- SDK: Reusable client for external adapters.

## Plan of Work

First, create the new folder structure under `packages/omnicore/src` and physically move files to their new homes. Then update every import to the new paths, including path-sensitive logic such as migration directory resolution. Next, update the package scripts in `packages/omnicore/package.json` so they point at the new entrypoint paths for `dev:*`, `kernel`, and `supervisor`. Finally, update `packages/omnicore/src/index.ts` to re-export from the new locations. After these edits, run `pnpm run check-types` from the repo root; if turbo fails again, run `pnpm --filter @bbot/omnicore check-types` as a targeted fallback and capture the outcome.

## Concrete Steps

All commands run from repository root ` /Users/wibus/dev/bbot ` unless noted otherwise. These steps were executed during this change; re-running move commands may require skipping files that already moved.

1) Create the new directory layout.

   mkdir -p packages/omnicore/src/domain \
     packages/omnicore/src/infra/views \
     packages/omnicore/src/runtime/traits \
     packages/omnicore/src/entry \
     packages/omnicore/src/sdk \
     packages/omnicore/src/transport

2) Move files into their new locations.

   mv packages/omnicore/src/events.ts packages/omnicore/src/domain/events.ts
   mv packages/omnicore/src/adapters/protocol.ts packages/omnicore/src/domain/adapter-protocol.ts
   mv packages/omnicore/src/adapters/hub.ts packages/omnicore/src/transport/adapter-hub.ts
   mv packages/omnicore/src/adapters/client.ts packages/omnicore/src/sdk/adapter-client.ts
   mv packages/omnicore/src/adapters/cli-adapter.ts packages/omnicore/src/entry/cli-adapter.ts
   mv packages/omnicore/src/kernel.ts packages/omnicore/src/runtime/kernel.ts
   mv packages/omnicore/src/reasoner.ts packages/omnicore/src/runtime/reasoner.ts
   mv packages/omnicore/src/traits/* packages/omnicore/src/runtime/traits/
   mv packages/omnicore/src/config.ts packages/omnicore/src/runtime/config.ts
   mv packages/omnicore/src/config-store.ts packages/omnicore/src/infra/config-store.ts
   mv packages/omnicore/src/db.ts packages/omnicore/src/infra/db.ts
   mv packages/omnicore/src/event-store.ts packages/omnicore/src/infra/event-store.ts
   mv packages/omnicore/src/migrations.ts packages/omnicore/src/infra/migrations.ts
   mv packages/omnicore/src/projection-store.ts packages/omnicore/src/infra/projection-store.ts
   mv packages/omnicore/src/session-store.ts packages/omnicore/src/infra/session-store.ts
   mv packages/omnicore/src/conversation-context.ts packages/omnicore/src/infra/conversation-context.ts
   mv packages/omnicore/src/views/context-view.ts packages/omnicore/src/infra/views/context-view.ts
   mv packages/omnicore/src/cli.ts packages/omnicore/src/entry/cli.ts
   mv packages/omnicore/src/supervisor.ts packages/omnicore/src/entry/supervisor.ts

3) Update imports to new paths, including `migrations.ts` path to the `migrations` directory (now needs `.. / ..`), and update any references to the adapter protocol, hub, and client.

4) Update `packages/omnicore/package.json` scripts to point at the new entrypoint files, for example `tsx src/entry/cli.ts` and `tsx src/entry/cli-adapter.ts`.

5) Update `packages/omnicore/src/index.ts` exports to point at the new file locations so downstream packages keep working.

6) Run type checks.

   pnpm run check-types

   If turbo crashes again, run:

   pnpm --filter @bbot/omnicore check-types

## Validation and Acceptance

The change is accepted when `pnpm run check-types` passes, or the targeted `pnpm --filter @bbot/omnicore check-types` passes if turbo crashes. The CLI entrypoints should still be available at the new paths, and the adapter dev script should still compile (`pnpm --filter @bbot/omnicore dev:adapter`). No functional behavior is expected to change.

## Idempotence and Recovery

File moves and import updates are idempotent when re-run; if a move command fails because a file already moved, skip it and continue. If a mistake is made, move the file back to its previous path and re-run the relevant import updates. No data migrations or destructive operations are involved.

## Artifacts and Notes

Actual turbo crash output from this run:

  Oops! Turbo has crashed.
  A report has been written to /var/folders/c7/r4_0jrd91zg4n58001d0pl3r0000gn/T/report-a708d0a9-3d6c-444a-aae0-f009d0a2378a.toml

Fallback type check transcript:

  > @bbot/omnicore@0.0.0 check-types /Users/wibus/dev/bbot/packages/omnicore
  > tsc -p tsconfig.json --noEmit

## Interfaces and Dependencies

The final layout must include the following public modules and exports:

- `packages/omnicore/src/domain/events.ts` exports the `Event`, `Action`, and helper creators (`createEvent`, `createTraceId`).
- `packages/omnicore/src/domain/adapter-protocol.ts` exports the adapter WebSocket message shapes.
- `packages/omnicore/src/sdk/adapter-client.ts` exports the `AdapterClient` for adapter implementers.
- `packages/omnicore/src/transport/adapter-hub.ts` provides the WebSocket server used by the kernel.
- `packages/omnicore/src/runtime/kernel.ts` remains the orchestrator that wires together infra + transport + reasoner.
- `packages/omnicore/src/entry/cli.ts` and `packages/omnicore/src/entry/supervisor.ts` remain CLI entrypoints.

All exports in `packages/omnicore/src/index.ts` must be updated to point to the new paths so other packages can import the same symbols without knowing the new layout.

## Revision Notes

2026-02-16: Updated Progress, Context and Orientation, Decision Log, Outcomes & Retrospective, and Artifacts to reflect completed file moves, import/script updates, and validation results after executing the refactor.
