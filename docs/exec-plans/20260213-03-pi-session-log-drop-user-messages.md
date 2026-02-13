# Pi-Style Session Log With Thread Search (Drop user_messages)

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

PLANS requirements apply. See /Users/wibus/dev/bbot/.agents/PLANS.md and keep this document consistent with it.

## Purpose / Big Picture

After this change, the agent will keep full multi-turn context by replaying a Pi-style session log (user, assistant, tool calls, and tool results). Workspace resume/search will match the entire thread, including assistant replies, rather than only user prompts. The legacy user_messages table and its API surface will be removed to avoid split sources of truth. The existing compaction pipeline in packages/agent will remain the single place that summarizes context, and compaction summaries will be persisted as session entries so they can be reused across runs.

You can see it working by running two prompts in the same workspace and verifying that the second response references the first, then performing a resume search using a keyword that appears only in an assistant response and observing that the workspace is returned.

## Progress

- [x] (2026-02-13 00:00Z) Created ExecPlan to replace user_messages with session_entries and move search to full thread.
- [x] (2026-02-13 00:00Z) Added session_entries schema (including summary entries), dropped user_messages schema, and generated migration with backfill.
- [x] (2026-02-13 00:00Z) Removed user_messages types, serializers, services, and the /runs/:id/messages endpoint; regenerated OpenAPI and SDK.
- [x] (2026-02-13 00:00Z) Persisted session_entries for prompts, assistant messages, tool actions, tool results, and compaction summaries.
- [x] (2026-02-13 00:00Z) Built deterministic context loader with summary injection, trimming, and exclusion of the current run.
- [x] (2026-02-13 00:00Z) Updated workspace search to query session_entries.search_text across the full thread.
- [ ] Validate two-run memory and thread search behavior.

## Surprises & Discoveries

- Observation: The agent currently starts each run with empty messages, so context is discarded across runs.
  Evidence: packages/agent/src/index.ts initializes messages to an empty array, and RunDispatcher does not load history.

- Observation: openapi:generate failed in the sandbox due to tsx IPC permissions.
  Evidence: Error "listen EPERM: operation not permitted ... tsx-501/XXXX.pipe" when running pnpm --filter @bbot/core-daemon openapi:generate.

## Decision Log

- Decision: Replace user_messages with a new append-only session_entries table and remove user_messages entirely.
  Rationale: A single canonical session log avoids split sources of truth and supports full thread replay and search.
  Date/Author: 2026-02-13 / Wibus + Codex

- Decision: Store both message entries (AgentMessage payloads) and explicit action/result entries for tool executions.
  Rationale: Messages enable LLM replay; action/result entries provide deterministic tool audit trails.
  Date/Author: 2026-02-13 / Wibus + Codex

- Decision: Add search_text to session_entries for fast thread search, populated only for message entries.
  Rationale: Resume/search must match the full thread, including assistant responses.
  Date/Author: 2026-02-13 / Wibus + Codex

- Decision: Exclude current-run session entries from context injection to avoid duplicating the current prompt.
  Rationale: The current prompt is already passed to agent.prompt and should not be replayed again.
  Date/Author: 2026-02-13 / Wibus + Codex

- Decision: Implement deterministic trimming using AGENT_CONTEXT_MAX_MESSAGES and AGENT_CONTEXT_MAX_CHARS.
  Rationale: The context must be bounded in a deterministic way without token estimation.
  Date/Author: 2026-02-13 / Wibus + Codex

- Decision: Persist compaction summaries as session_entries of kind summary and re-inject them when building context.
  Rationale: Compaction already exists in packages/agent; persisting summaries avoids re-summarizing the entire thread on every run.
  Date/Author: 2026-02-13 / Wibus + Codex

## Outcomes & Retrospective

No outcomes yet. This section will be updated after implementation and validation.

## Context and Orientation

The core-daemon in apps/core-daemon orchestrates runs. Each run is stored in the runs table and streamed via run_events. The agent runtime in packages/agent uses @mariozechner/pi-agent-core. The existing user_messages table is a legacy audit sink used for resume/search and an API endpoint; it is not used for context injection. This plan removes user_messages and introduces session_entries as the canonical log of a session. The plan updates run orchestration, search, and API/SDK outputs to align with the new log.

Relevant files include:
- packages/database/schemas/index.ts for schema definitions.
- apps/core-daemon/src/modules/runs/dispatcher.ts for agent event handling.
- apps/core-daemon/src/modules/workspaces/service.ts for run creation and search.
- packages/agent/src/index.ts for agent setup and context injection.
- packages/protocol/src/schema/runs.ts for API schemas and packages/sdk for generated clients.

## Plan of Work

First, define a new enum session_entry_kind and a session_entries table in packages/database/schemas/index.ts. The table must include id, session_id, run_id, kind, payload (jsonb), search_text (text), timestamp, and a sequence column using bigserial for deterministic ordering. Add indexes on (session_id, sequence), (run_id, sequence), and (session_id, search_text) for lookup and search. Then remove the user_message_kind enum and user_messages table from the schema. Generate a migration that creates session_entries, optionally backfills existing user_messages into message entries, and drops user_messages and its enum.

Next, remove user_messages from the domain types and the in-memory packages/core implementation. Delete serializers, services, and the /runs/:id/messages endpoint. Update protocol schemas and regenerate openapi.json and SDK outputs so getRunsByIdMessages no longer exists.

Then, persist session_entries during run lifecycle. On run creation, insert a message entry with the user prompt as a UserMessage payload and compute search_text. In RunDispatcher, on message_end insert an assistant message entry using the AgentMessage payload. On tool_execution_start insert an action entry with tool name and args. On tool_execution_end insert both a ToolResult message entry (role toolResult) and a result entry containing the raw tool result and error status. When compaction runs inside packages/agent, capture the generated summary and persist it as a summary entry so future runs can reuse it. All entries must be inserted in event order to preserve sequence.

After persistence is in place, add a deterministic context builder in packages/agent that consumes session_entries, injects the latest summary entry as a compaction summary message, filters to message entries, drops entries from the current run, and trims by max count and max character budget. Extend runAgent to accept contextMessages and a compaction callback so the existing transformContext can persist summaries when it compacts. Ensure assistant messages missing api/provider/model/usage fields are normalized with defaults when building context to keep LLM conversion stable.

Finally, update workspace resume/search to query session_entries.search_text rather than user_messages. Search must match keywords present only in assistant responses, proving full-thread matching. Update this ExecPlan as implementation progresses.

## Concrete Steps

Run all commands from /Users/wibus/dev/bbot.

1) Generate migrations after schema changes.

    pnpm db:generate

Expect a new SQL migration file and a snapshot update under packages/database/migrations/meta.

2) Apply migrations to a local database.

    pnpm db:migrate

If the database is not available, configure DATABASE_URL and retry.

3) Regenerate OpenAPI and SDK after protocol changes.

    pnpm --filter @bbot/core-daemon openapi:generate
    pnpm workflow:sdk

4) Start core-daemon and verify behavior.

    pnpm --filter @bbot/core-daemon dev

## Validation and Acceptance

Memory validation:
- Run 1 prompt: “Remember this token: red-fox-77.”
- Run 2 prompt: “What token did I ask you to remember?”
- The second response must include “red-fox-77” without re-supplying it.

Thread search validation:
- Run 1 prompt: “Say a unique word in your response: aurora-knife-91.”
- Call /workspaces/search with query “aurora-knife-91”.
- The workspace must be returned even though the user did not type that word.

Schema validation:
- session_entries contains message, action, and result rows for a run that used tools.

## Idempotence and Recovery

Schema changes are additive until the final drop of user_messages. If migration fails, fix the error and rerun pnpm db:migrate. If backfill is included and needs re-running, ensure it is guarded (INSERT ... SELECT with a WHERE NOT EXISTS condition) to avoid duplicates.

## Artifacts and Notes

Example query to validate ordering:

    select sequence, kind, payload->'message'->>'role' as role, timestamp
    from session_entries
    where session_id = '<sessionId>'
    order by sequence asc
    limit 20;

## Interfaces and Dependencies

In packages/database/schemas/index.ts, define:

    sessionEntryKind: "message" | "action" | "result" | "summary" | "system"
    sessionEntries: id, sessionId, runId, kind, payload, searchText, timestamp, sequence

In packages/domain/src/index.ts, define:

    export type SessionEntryKind = "message" | "action" | "result" | "summary" | "system"
    export interface SessionEntry { id: string; sessionId: string; runId?: string; kind: SessionEntryKind; payload: Record<string, unknown>; searchText?: string; timestamp: number; sequence: number }

In apps/core-daemon/src/modules/runs/service.ts (or a new session-log module), define:

    export const createSessionEntry(db, input)
    export const listSessionEntries(db, options)

In packages/agent/src/index.ts, extend RunAgentOptions with:

    contextMessages?: AgentMessage[]
    maxContextMessages?: number
    maxContextChars?: number
    onCompaction?: (summary: string) => void

Add a helper in packages/agent/src/context.ts:

    export const buildContextMessages(entries, options): AgentMessage[]

This helper must be deterministic, not mutate inputs, and normalize assistant messages with missing metadata. It must also inject the latest summary entry (if present) as a compaction summary message compatible with packages/agent/src/compaction/compactor.ts.

Change Note (2026-02-13): Updated the plan to integrate the existing compaction pipeline by persisting compaction summaries as session_entries and re-injecting them during context building. This aligns the refactor with the current system prompt and compaction architecture.
