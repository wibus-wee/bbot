# Add Run Cancellation and Auto-Supersede

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

PLANS.md lives at `.agents/PLANS.md` in the repository root. This document must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, users can stop a running agent run on demand and the system will automatically stop an in-progress run when a new prompt arrives for the same session. The Telegram bot will expose a `/cancel` command that stops the active run. The API will expose a cancel endpoint that changes run status to `canceled`, emits a `run.canceled` event for SSE clients, and actually aborts the agent execution rather than only closing the stream. You can verify this by starting a run, calling the cancel endpoint, and observing that the run stops quickly with a `run.canceled` event and status.

## Progress

- [x] (2026-02-13 18:20Z) Draft ExecPlan and confirm design choices.
- [x] (2026-02-13 18:40Z) Add run cancellation status/event to schema, protocol, and SDK; regenerate OpenAPI + SDK.
- [x] (2026-02-13 18:55Z) Implement cancellation flow in core-daemon (dispatcher, API, workspace auto-cancel) with conditional status updates.
- [x] (2026-02-13 19:05Z) Add Telegram `/cancel` command and active run tracking.
- [x] (2026-02-13 19:11Z) Validate behavior with targeted tests or manual run and update outcomes (completed: agent tests and core-daemon cancel test; remaining: manual cancel flow).

## Surprises & Discoveries

- Observation: `pnpm workflow:sdk` fails in sandbox due to `tsx` IPC pipe permissions and requires escalation.
  Evidence: `listen EPERM: operation not permitted ... /var/folders/.../tsx-*/.pipe`

## Decision Log

- Decision: Use `Agent.abort()` from `@mariozechner/pi-agent-core` to stop actual agent execution, triggered by a new cancel endpoint and auto-supersede behavior.
  Rationale: This is the only supported mechanism that cancels in-flight LLM calls and tools at the Agent level, matching best practice and user expectation.
  Date/Author: 2026-02-13 / Codex

- Decision: Introduce `run.status = canceled` and `run.canceled` run event instead of overloading `failed`.
  Rationale: Cancellation is a user-driven stop, not an error, and should be distinguishable in UI and logs.
  Date/Author: 2026-02-13 / Codex

- Decision: Use conditional status updates (`updateRunStatusIf`) when transitioning to `running`/`succeeded`/`failed`.
  Rationale: Prevents race conditions where a late cancel would be overwritten by a completion update.
  Date/Author: 2026-02-13 / Codex

## Outcomes & Retrospective

- Implemented end-to-end cancellation and auto-supersede wiring, plus Telegram `/cancel`. OpenAPI/SDK regenerated. Agent tests and core-daemon cancel test executed; manual end-to-end validation still pending.

## Context and Orientation

Core-daemon is the API server that owns run state and dispatches agents. The run lifecycle is implemented in `apps/core-daemon/src/modules/runs/dispatcher.ts`, which currently has no cancellation logic. The HTTP endpoints are in `apps/core-daemon/src/modules/runs/index.ts`, and workspace runs are created via `apps/core-daemon/src/modules/workspaces/index.ts` and `apps/core-daemon/src/modules/workspaces/service.ts`. The Telegram bot lives in `apps/bot-telegram/src` and currently only controls SSE streaming; it does not stop the actual run. The agent wrapper is `packages/agent/src/index.ts` and uses `@mariozechner/pi-agent-core`, which exposes `Agent.abort()`.

The database schema for runs is in `packages/database/schemas/index.ts` and run status values are stored as the `run_status` enum. Protocol and SDK types live under `packages/protocol/src/schema` and `packages/sdk/src` and must be regenerated via `pnpm workflow:sdk` after changing API schemas.

## Plan of Work

First, extend the run status and event enums to include cancellation. This requires updating `packages/database/schemas/index.ts`, `packages/domain/src/index.ts`, and `packages/protocol/src/schema/runs.ts`, plus a new migration that adds enum values. Add a new run event type `run.canceled` in both schema and protocol. Regenerate the SDK and OpenAPI once the API layer is updated.

Second, add cancellation support to the agent wrapper and dispatcher. In `packages/agent/src/index.ts`, accept an optional `AbortSignal` and wire it to `Agent.abort()` to stop execution. In `apps/core-daemon/src/modules/runs/dispatcher.ts`, track active runs in memory with an AbortController per run ID. Implement `cancelRun(runId, reason?)` and `cancelRunsForSession(sessionId, reason?)` that update the database to `canceled`, emit a `run.canceled` event, and abort the active Agent if running. Ensure `execute()` does not overwrite a canceled run with `succeeded` or `failed`.

Third, add a new API endpoint `POST /runs/:id/cancel` in `apps/core-daemon/src/modules/runs/index.ts`. This endpoint should be idempotent: if the run is already finished or canceled, return the current run state without error. Otherwise, request cancellation via the dispatcher and return the updated run.

Fourth, implement auto-supersede in `apps/core-daemon/src/modules/workspaces/index.ts`. Before creating a new run for a session, call `dispatcher.cancelRunsForSession(sessionId, "superseded")` to stop any queued or running runs for that session.

Fifth, update the Telegram bot. Add `/cancel` to `apps/bot-telegram/src/commands.ts`, track the active run ID per chat (likely in `apps/bot-telegram/src/sessions.ts`), and add a cancel call in `apps/bot-telegram/src/api.ts` that hits the new cancel endpoint. Update `apps/bot-telegram/src/stream.ts` to stop on `run.canceled` and clear the active run ID when a run ends or is canceled.

Finally, validate behavior by running the agent tests and performing a manual end-to-end run + cancel scenario. Update this ExecPlan’s Progress and Outcomes sections with results.

## Concrete Steps

Run these commands from the repository root unless noted otherwise.

1. Create a migration that adds `canceled` to `run_status` and `run.canceled` to `run_event_type`.
   Expected: `packages/database/migrations/0006_*` exists with `ALTER TYPE ... ADD VALUE IF NOT EXISTS` statements.

2. Update schema and protocol types.
   Files to edit:
   - `packages/database/schemas/index.ts`
   - `packages/domain/src/index.ts`
   - `packages/protocol/src/schema/runs.ts`

3. Implement cancellation in dispatcher and agent wrapper.
   Files to edit:
   - `packages/agent/src/index.ts`
   - `apps/core-daemon/src/modules/runs/dispatcher.ts`
   - `apps/core-daemon/src/modules/runs/service.ts` (for query helpers)

4. Add cancel endpoint and auto-supersede.
   Files to edit:
   - `apps/core-daemon/src/modules/runs/index.ts`
   - `apps/core-daemon/src/modules/workspaces/index.ts`

5. Update Telegram bot.
   Files to edit:
   - `apps/bot-telegram/src/commands.ts`
   - `apps/bot-telegram/src/sessions.ts`
   - `apps/bot-telegram/src/api.ts`
   - `apps/bot-telegram/src/bot.ts`
   - `apps/bot-telegram/src/stream.ts`

6. Regenerate SDK and OpenAPI.

   Command:
     pnpm workflow:sdk

7. Run tests (at least agent tests). If core-daemon tests exist, run them too.

   Commands:
     pnpm --filter @bbot/agent test
     pnpm --filter @bbot/core-daemon test

## Validation and Acceptance

- Start a run and call `POST /runs/:id/cancel`. Expect a `run.canceled` SSE event and `GET /runs/:id` to return `status = canceled` with `finishedAt` set.
- Start a run, then send a new prompt for the same session. Expect the previous run to be canceled automatically and the new run to start.
- In Telegram, start a run and invoke `/cancel`. Expect the bot to acknowledge cancellation and the SSE stream to stop after receiving `run.canceled`.
- Running `pnpm --filter @bbot/agent test` should still pass; core-daemon tests (if any) should also pass.

## Idempotence and Recovery

The migration uses `ALTER TYPE ... ADD VALUE IF NOT EXISTS`, so re-running it is safe. Cancel requests are idempotent: if a run is already finished, the endpoint should return the current run state without changing it. If a cancellation is requested while a run is already stopping, the dispatcher should handle it without throwing and should clean up in-memory tracking when the run finishes.

## Artifacts and Notes

Expected SSE snippet after cancel:

  event: run.canceled
  data: {"id":"...","message":"Run canceled","payload":{"reason":"user"},"timestamp":"..."}

Expected run status after cancel:

  status: "canceled"
  finishedAt: "2026-02-13T...Z"

## Interfaces and Dependencies

- `packages/agent/src/index.ts` must accept an optional `AbortSignal` in `RunAgentOptions` and call `Agent.abort()` when signaled.
- `apps/core-daemon/src/modules/runs/dispatcher.ts` must expose:
  - `cancelRun(runId: string, reason?: string): Promise<Run | null>`
  - `cancelRunsForSession(sessionId: string, reason?: string): Promise<void>`
- `apps/core-daemon/src/modules/runs/index.ts` must expose `POST /runs/:id/cancel` returning a `runResponse`.
- Database enums must include `run_status = canceled` and `run_event_type = run.canceled`.

Change log: Updated progress to reflect implementation, recorded tsx sandbox escalation, and noted conditional status updates to prevent cancel races.
