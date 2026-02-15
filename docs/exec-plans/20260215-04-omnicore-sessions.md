# Add OmniCore Chat Sessions (Stream IDs)

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows the requirements in `/.agents/PLANS.md` from the repository root and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, OmniCore will support explicit chat sessions like ChatGPT threads. Every event will carry a `sessionId` so the kernel can build context, summaries, and compaction per session instead of per adapter or per user. A CLI adapter user can start a new session on demand, continue an existing session by ID, and see which session they are currently using. This makes the system event-sourced and session-scoped without coupling to any external channel.

## Progress

- [x] (2026-02-15 18:05Z) Drafted the session design and identified the files that need updates.
- [x] (2026-02-15 18:32Z) Added `sessionId` storage in migrations and event-store reads/writes, plus DBML regeneration.
- [x] (2026-02-15 18:35Z) Updated event types, helpers, and all event writers/readers to carry `sessionId`.
- [x] (2026-02-15 18:40Z) Scoped conversation assembly, summaries, and compaction to `sessionId`.
- [x] (2026-02-15 18:44Z) Added CLI adapter session commands (`/new`, `/use`, `/session`) and default session handling.
- [x] (2026-02-15 18:49Z) Updated README and ran required checks/migrations.

## Surprises & Discoveries

No surprises yet.

## Decision Log

- Decision: Use a session ID as the primary stream key for context and compaction, independent of platform or actor ID.
  Rationale: This matches the desired “AI chat thread” semantics while keeping the kernel platform-agnostic.
  Date/Author: 2026-02-15 / Codex

- Decision: Treat session creation as an adapter concern and log an optional `session.created` event for observability, rather than adding a mandatory session registry in the kernel.
  Rationale: Keeps the kernel minimal and event-sourced while allowing adapters to manage UI/UX for sessions.
  Date/Author: 2026-02-15 / Codex

- Decision: Include `sessionId` in kernel-to-adapter action envelopes (protocol) so adapters can route or annotate responses.
  Rationale: Allows multi-session clients to disambiguate responses without changing action semantics.
  Date/Author: 2026-02-15 / Codex

## Outcomes & Retrospective

OmniCore now treats sessions as the primary conversation boundary. Events, compaction, and summaries are scoped by `sessionId`, and the CLI adapter can start/switch sessions explicitly. Required migrations and type checks were run. Follow-up improvements could add a session registry view if a UI needs listing/archival.

## Context and Orientation

OmniCore lives in `packages/omnicore`. Events are persisted in SQLite (`packages/omnicore/src/event-store.ts`) and written via `createEvent` in `packages/omnicore/src/events.ts`. The kernel (`packages/omnicore/src/kernel.ts`) reads events to build a conversation context (`packages/omnicore/src/conversation-context.ts`), runs `@bbot/agent`, and emits `send_message` actions over the adapter hub (`packages/omnicore/src/adapters/hub.ts`). The CLI adapter (`packages/omnicore/src/adapters/cli-adapter.ts`) is a simple local channel for testing.

“Session” in this plan means a single AI chat thread (a stream boundary). It is not a Discord/Telegram thread, and it is not a database entity that must be persisted as its own table. The session ID is an event header value that partitions the event stream for context, summaries, and compaction.

## Plan of Work

First, extend the event storage schema by adding `session_id` to the `events` table and indexing it, with a migration that backfills existing rows to a default session ID. Update `packages/omnicore/src/event-store.ts` to read/write `session_id`, and update `docs/dev/database-schema.dbml` via the repo workflow.

Next, update `packages/omnicore/src/events.ts` to add a required `sessionId` field on `Event`, define a default/system session constant, and optionally add a `session.created` event type. Update all event creation sites (kernel, reasoner, CLI, heartbeat) to include a session ID. Update the adapter protocol to include session ID in outgoing kernel actions so adapters can correlate responses.

Then, update conversation assembly and compaction logic. `collectConversationEntries` should take `sessionId` and filter events by that value. Summary detection and assistant message de-duplication should operate within a session. `kernel.ts` should call these functions per session, and auto-compaction should run per session instead of per actor.

Finally, update the CLI adapter to manage explicit sessions. It should generate a default session ID on startup (or use `OMNICORE_SESSION_ID` if provided), support `/new` to create a new session, `/use <id>` to switch, and `/session` to display the current session. When switching, it should emit a `session.created` event for the new session so the event log reflects the boundary. Update `packages/omnicore/README.md` to document session usage and the new CLI commands.

## Concrete Steps

Work from the repo root (`/Users/wibus/dev/bbot`).

1. Add a migration for `events.session_id` and update the event store to read/write that column.
2. Update `packages/omnicore/src/events.ts`, `packages/omnicore/src/event-store.ts`, `packages/omnicore/src/kernel.ts`, `packages/omnicore/src/reasoner.ts`, and `packages/omnicore/src/conversation-context.ts` to pass `sessionId` through the system.
3. Update `packages/omnicore/src/adapters/cli-adapter.ts` and `packages/omnicore/src/adapters/protocol.ts` to support explicit sessions and send session IDs with events and actions.
4. Update `packages/omnicore/README.md` with session guidance.
5. Run required commands:
   - `pnpm run db:generate`
   - `pnpm run workflow:dbml`
   - `pnpm run db:migrate`
   - `pnpm --filter @bbot/omnicore check-types`
   - `pnpm run check-types` (expect the known root `packageManager` error)

## Validation and Acceptance

Start the kernel and CLI adapter, then create a new session and verify that context resets between sessions.

Example (in separate terminals):

    pnpm --filter @bbot/omnicore dev:kernel
    pnpm --filter @bbot/omnicore dev:adapter

In the CLI adapter, run:

    /session
    /new
    hello in new session

Expected:

- The adapter prints the current session ID after `/session`.
- `/new` prints a new session ID.
- Messages sent in the new session are answered without carrying context from the previous session (you can confirm by asking the model to repeat the earlier message; it should not).

## Idempotence and Recovery

The migration is additive and safe to re-run; if it has already been applied, `schema_migrations` will skip it. If a mistake is found, apply the down migration to rebuild the `events` table without `session_id`, then re-run the updated up migration. The CLI changes are isolated to the adapter and can be reverted without touching persisted data.

## Artifacts and Notes

During implementation, capture the migration file names and any relevant logs in this section so a new contributor can locate changes quickly.

## Interfaces and Dependencies

Events must satisfy the following interface in `packages/omnicore/src/events.ts`:

    interface Event<TPayload> {
      id: string;
      type: EventType;
      timestamp: string;
      actorId: string | null;
      traceId: string;
      sessionId: string;
      causationId?: string;
      payload: TPayload;
    }

The CLI adapter should accept the commands `/new`, `/use <id>`, and `/session`, generating a new UUID for sessions unless `OMNICORE_SESSION_ID` is set. It should send all inbound events with `sessionId` populated, and kernel actions should include `sessionId` in the message envelope.
