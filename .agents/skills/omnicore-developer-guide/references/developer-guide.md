# OmniCore Developer Guide

This document explains the current OmniCore architecture, design philosophy, and how the system is wired together. It focuses on what exists today and what is intentionally deferred.

**Purpose**

OmniCore is an AI-native kernel. It does not know Telegram/Discord/Slack. Channels are external adapters that connect over WebSocket and exchange events. The kernel turns events into reasoning runs and actions, logs everything in an event store, and keeps lightweight projections for fast reads.

**Design Philosophy**

- Kernel-first: the kernel only understands events and actions, not channels.
- Event-sourced: the event log is the source of truth; projections are derived.
- Session-scoped: a session is a chat thread and the boundary for context, summaries, and compaction.
- Root-path scoped: each session can run in its own root path; the kernel reads session files from that root.
- Minimal core: internal tools are not implemented in OmniCore; tooling is delegated to `@bbot/agent`.
- Unix-aligned: clear, composable interfaces (CLI and WebSocket protocol) and predictable state transitions.

**Core Concepts**

- Kernel: the brain. Accepts events, runs the agent, emits actions.
- Adapter: a channel plugin. Converts inbound messages into events and receives actions.
- Session: a chat thread. All context and summaries are scoped by `sessionId`.
- Event log: append-only SQLite table of everything that happened.
- Projection: derived tables for quick reads, not sources of truth.

**System Components**

- Kernel: `packages/omnicore/src/kernel.ts`
- Event store: `packages/omnicore/src/event-store.ts`
- Session projection: `packages/omnicore/src/session-store.ts`
- Adapter hub: `packages/omnicore/src/adapters/hub.ts`
- CLI adapter: `packages/omnicore/src/adapters/cli-adapter.ts`
- Agent runner: `packages/omnicore/src/reasoner.ts` (delegates to `@bbot/agent`)

**Event Flow (High Level)**

1. Adapter sends an inbound event:
   - `type: "signal.inbound"`
   - `sessionId` identifies the chat thread
2. Kernel records the event into the SQLite log.
3. Kernel builds session context from the event log and summaries.
4. Kernel runs `@bbot/agent` with that context.
5. Kernel emits actions:
   - `send_message` for replies
   - `send_status` for status lines (e.g. thinking)
   - `restart` if the agent requested a restart
6. Adapter receives and renders actions.

**Sessions**

- A session is a chat thread (similar to ChatGPT threads).
- All context building, summarization, and compaction are session-scoped.
- Sessions are projected into a `sessions` table for quick listing and archival.

**Session Root Path**

Each session can have its own root path. The kernel reads these files from the session root:

- `AGENTS.md`
- `HEARTBEAT.md` (currently not consumed by the kernel)
- `MISSION.md` (currently not consumed by the kernel)
- `MEMORY.md`

Rules:

- Root paths are stored as absolute paths in the session projection.
- Root path can be set before the first LLM call.
- After the first LLM call, the session root is locked.

Implementation detail:

- `session.root.set` event sets the root path.
- `agent.run.start` event locks the root path.

**Event Types (Selected)**

- `signal.inbound`: inbound user message
- `signal.internal`: internal signal (heartbeat)
- `session.created`: session boundary created by adapter
- `session.renamed`: rename a session
- `session.archived`: archive a session
- `session.root.set`: set session root path (only before first LLM call)
- `agent.run.start`: marks first LLM call for the session
- `agent.message`: assistant message recorded from the agent runtime
- `agent.summary`: summary produced by compaction
- `action.requested`: action requested by kernel
- `action.executed`: action execution result

**Compaction and Summaries**

- Context is reconstructed from session events.
- When token usage crosses a threshold, the kernel compacts the conversation:
  - Calls `compactMessages` from `@bbot/agent`.
  - Emits `agent.summary` to store the summary.
  - Re-logs kept assistant messages as `agent.message` events.
- Summaries and recent messages form the next session context.

**Heartbeat**

- Today: a single kernel heartbeat emits `signal.internal` in the `session:system` session.
- There is no per-session heartbeat scheduler yet.
- `HEARTBEAT.md` exists as a human-authored file but is not consumed by the kernel.

**Supervisor and Restart**

- The supervisor process watches for `restart` actions and respawns the kernel.
- The CLI adapter reconnects automatically on WS disconnect and buffers outgoing messages.

**Adapters and Protocol**

Adapters connect to the kernel over WebSocket.

Adapter -> Kernel:

```
{"type":"hello","adapterId":"cli"}
{"type":"event","event":{...}}
```

Kernel -> Adapter:

```
{"type":"action","action":{...},"traceId":"...","sessionId":"..."}
```

Routing rule: `actorId` is prefixed with `adapterId` (e.g. `cli:local`).

**CLI Adapter**

The CLI adapter supports simple commands:

- `/session` show current session id
- `/new` start a new session
- `/use <sessionId>` switch session

It displays:

- reply messages (`send_message`)
- status lines (`send_status`) such as `thinking...`

It also reconnects automatically if the kernel restarts.

**Configuration and Secrets**

Configuration is stored in SQLite (not environment variables):

- model provider
- model name
- base URL
- thinking level
- compaction settings
- API key stored in `secrets`

**What Is Not Implemented Yet**

- Per-session heartbeat scheduler
- Parsing or executing `HEARTBEAT.md` and `MISSION.md`
- Agent-managed sub-sessions
- UI or web dashboard

**How To Extend**

- Add a new adapter: implement the WebSocket protocol and emit `signal.inbound` events.
- Add new projections: append events and update derived tables in `SessionStore` or a new store.
- Add new actions: extend `Action` in `events.ts`, update the adapter protocol, and handle in kernel.

**Operational Guarantees**

- The event log is append-only and is the source of truth.
- Projections can be rebuilt from the event log.
- Session root path cannot be changed after the first LLM call.
