# Add Assistant Message Events to Run Stream

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

PLANS.md reference: follow `/.agents/PLANS.md` from the repository root for all ExecPlan requirements and update rules.

## Purpose / Big Picture

After this change, the run SSE stream emits explicit assistant message events so the Telegram bot can show only the user-friendly output (latest tool action plus final assistant response) without raw run status lines. Users will see the latest tool action and the final assistant text, with no "Run completed" noise.

## Progress

- [x] (2026-02-13 02:20Z) Reviewed SSE stream implementation and run/session entry storage to determine how to emit assistant messages without schema changes.
- [x] (2026-02-13 02:40Z) Added run stream emission of assistant messages by reading session entries for the run.
- [x] (2026-02-13 02:55Z) Updated Telegram bot stream rendering to consume assistant message events and display the latest tool line.
- [x] (2026-02-13 04:05Z) Disabled message fallback to prevent duplicate assistant/tool messages and switched thinking rendering to blockquote.
- [x] (2026-02-13 04:25Z) Render thinking blocks as plain expanded blockquotes with no prefix.
- [x] (2026-02-13 04:40Z) Render assistant output via Markdown-to-HTML conversion to preserve formatting.
- [x] (2026-02-13 04:50Z) Render thinking blocks with the same Markdown-to-HTML conversion (no blockquote styling).
- [x] (2026-02-13 05:05Z) Switched assistant/thinking rendering back to MarkdownV2 with a safe formatter.
- [ ] Validate behavior manually (send a prompt, see latest tool line, collapsed older tools, and final assistant text only).

## Surprises & Discoveries

- None observed.

## Decision Log

- Decision: Emit `assistant.message` events by polling `session_entries` for the run and filtering to assistant-role messages.
  Rationale: Avoids adding new run event types or database migrations while still providing the needed stream data.
  Date/Author: 2026-02-13 (Codex)

- Decision: Delay terminal run events (`run.completed`, `run.failed`, `run.canceled`) until after assistant messages are sent in the same poll cycle.
  Rationale: Prevents clients from closing the stream before receiving the assistant response.
  Date/Author: 2026-02-13 (Codex)

- Decision: Stream assistant text deltas via in-memory live events (`assistant.delta`) instead of persisting per-delta rows.
  Rationale: Keeps the database from exploding with tiny chunks while still enabling true SSE-style streaming.
  Date/Author: 2026-02-13 (Codex)

- Decision: Present tool calls in a dedicated message that is overwritten with the latest tool execution.
  Rationale: Keeps the UI concise and fixes ordering issues from previous accumulated tool lists.
  Date/Author: 2026-02-13 (Codex)

- Decision: Use a MarkdownV2 formatter to preserve common formatting while avoiding invalid Markdown errors.
  Rationale: User requested MarkdownV2 rendering; formatter escapes unsafe characters but keeps bold/italic/code/blockquote.
  Date/Author: 2026-02-13 (Codex)
- Decision: Disable fallback-to-new-message in stream updaters to avoid duplicate assistant/tool messages.
  Rationale: Editing failures should not create extra output; the bot should stay on a single streaming message per channel.
  Date/Author: 2026-02-13 (Codex)

## Outcomes & Retrospective

- Pending validation and user confirmation of UX.

## Context and Orientation

The run stream endpoint lives in `apps/core-daemon/src/modules/runs/index.ts` and currently emits run events from the `run_events` table. Assistant messages are stored separately in `session_entries` with `kind = "message"` and payloads that include `role: "assistant"`. The Telegram bot consumes the stream in `apps/bot-telegram/src/stream.ts` and currently renders raw run messages.

## Plan of Work

Add a service helper to list session entries by run, then augment the run stream to emit `assistant.message` events using those entries (filtered to assistant role). Update the Telegram bot stream handler to render assistant messages as the final output and to format tool executions with a single latest line (no history).

## Concrete Steps

1. Add `listRunSessionEntries` in `apps/core-daemon/src/modules/runs/service.ts`.
2. Update `apps/core-daemon/src/modules/runs/index.ts` to:
   - Track the last session entry sequence for the run.
   - Emit `assistant.message` SSE events for new assistant messages.
   - Send terminal events after assistant messages in each poll cycle.
3. Update `apps/bot-telegram/src/stream.ts` and `apps/bot-telegram/src/messages.ts` to:
   - Render latest tool execution line.
   - Render the latest tool execution line only (no history).
   - Render final assistant text without run status labels.

## Validation and Acceptance

Acceptance means:
- A prompt results in a user-friendly stream: latest tool line and final assistant text shown.
- No "Run queued", "Run started", or "Run completed" status lines are displayed to the user.

Manual validation: run the Telegram bot, send a prompt that triggers multiple tools, and confirm the formatting matches the requirement.

## Idempotence and Recovery

These changes are additive and can be re-run safely. If streaming regresses, revert the stream and bot changes and restore the previous run event rendering.

## Artifacts and Notes

No external artifacts produced. The primary artifacts are updated stream logic and bot rendering code.

## Interfaces and Dependencies

The new SSE event is:

    event: assistant.message
    data: { id, message, timestamp, sequence }

The Telegram bot should rely on this event for final assistant output and ignore run status messages except for stream termination.

---
Change log: initial ExecPlan created (2026-02-13) for run stream assistant message events.
