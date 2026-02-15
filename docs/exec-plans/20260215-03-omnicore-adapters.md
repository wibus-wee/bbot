# Add WebSocket Adapters and Agent Integration (Hot-Plug Channels)

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

PLANS.md is located at `/Users/wibus/dev/bbot/.agents/PLANS.md`. This document must be maintained in accordance with it.

## Purpose / Big Picture

We will make OmniCore channel-agnostic by moving Channel Trait out of the kernel and into hot-pluggable adapters that connect over WebSocket using JSON. The kernel will host an adapter hub and accept inbound events from any external adapter without restarting. Outbound actions (send_message) are routed back to the adapter based on actor identity. The CLI will become a supervisor-style control tool (status/restart) that operates via the SQLite event log. We will also integrate the existing `packages/agent` runtime as the kernel’s reasoning engine, capturing tool execution events for observability.

After this change, a user can:
- Start the kernel and connect a WebSocket adapter written in any language without restarting the kernel.
- Use a CLI adapter to send messages and receive replies via WebSocket.
- Use `omnicore status` to check last heartbeat and `omnicore restart` to trigger a restart via events.
- Run the agent logic through the existing `packages/agent` system.

## Progress

- [x] (2026-02-15 03:20Z) Created ExecPlan for WebSocket adapters + agent integration.
- [x] (2026-02-15 07:40Z) Add WebSocket adapter protocol types and adapter hub server.
- [x] (2026-02-15 07:40Z) Convert kernel to use adapter hub for inbound/outbound message routing.
- [x] (2026-02-15 07:50Z) Add CLI adapter client (WebSocket) and make CLI control commands (status/restart).
- [x] (2026-02-15 07:50Z) Integrate `packages/agent` as the kernel reasoning engine and log tool executions as events.
- [x] (2026-02-15 07:50Z) Remove internal Channel trait and any unused channel code.
- [x] (2026-02-15 07:55Z) Update README with adapter protocol and CLI usage.
- [x] (2026-02-15 08:05Z) Run `pnpm run check-types` (fails due to missing `packageManager`) and `pnpm --filter @bbot/omnicore check-types`.
- [x] (2026-02-15 07:55Z) Update this ExecPlan with actual progress, discoveries, and decisions as work completes.

## Surprises & Discoveries

- Agent tool names for file mutation are `write` and `edit`, so restarts can be tied to those tool executions.
- `pnpm run check-types` fails in Turbo due to missing `packageManager` in root `package.json`, but package-level check-types passes.

## Decision Log

- Decision: Use WebSocket + JSON for adapter hot-plugging, with no authentication (local only).
  Rationale: User requirement for language-agnostic hot-plug channels without restarts.
  Date/Author: 2026-02-15 (assistant)
- Decision: Actor IDs will be prefixed with adapter ID (e.g. `discord:12345`) for routing outbound actions.
  Rationale: Keeps kernel channel-agnostic while enabling precise routing to adapters.
  Date/Author: 2026-02-15 (assistant)
- Decision: CLI becomes a supervisor-style control tool (status/restart) and a separate CLI adapter connects over WS.
  Rationale: Aligns with hot-plug design while keeping admin controls simple and local.
  Date/Author: 2026-02-15 (assistant)
- Decision: Reuse `packages/agent` by calling `runAgent` with DB-provided provider/model and AGENTS.md instructions.
  Rationale: Avoids re-implementing agent logic and leverages existing system while fitting the kernel loop.
  Date/Author: 2026-02-15 (assistant)
- Decision: Auto-request restarts when the agent executes `write` or `edit` tools.
  Rationale: Ensures self-restart on code changes without requiring manual commands or channel-specific parsing.
  Date/Author: 2026-02-15 (assistant)

## Outcomes & Retrospective

- Not started.

## Context and Orientation

OmniCore currently has a channel trait built-in (CLI) and a SQLite-backed event store. The goal is to move all channel IO to external adapters via WebSocket. The kernel will host an adapter hub, receive inbound events via WS, and send outbound actions back to adapters. The CLI will no longer be a channel, but a control tool that writes events to SQLite. The agent logic should be delegated to `packages/agent`.

Key files to add or modify:

- `packages/omnicore/src/adapters/protocol.ts`: WS message types.
- `packages/omnicore/src/adapters/hub.ts`: WS server + routing.
- `packages/omnicore/src/adapters/cli-adapter.ts`: WS client adapter for local CLI.
- `packages/omnicore/src/cli.ts`: control commands (status/restart).
- `packages/omnicore/src/kernel.ts`: replace channel trait with adapter hub.
- `packages/omnicore/src/reasoner.ts`: integrate packages/agent runAgent.

## Plan of Work

Add a WebSocket dependency and implement an adapter hub in the kernel. The hub accepts `hello` and `event` messages from adapters and routes `action` messages back to the correct adapter based on actor ID prefix. Create a CLI adapter client that connects to the hub and uses stdin/stdout for a quick local channel. Update the kernel to send `send_message` actions through the adapter hub. Replace the internal CLI channel with this external adapter. Update the CLI tool to provide `status` and `restart` commands by reading/writing to SQLite, so it acts as a supervisor utility instead of a channel. Integrate `packages/agent` by calling `runAgent` inside the kernel and extracting assistant text for replies; also log tool execution events into the event store.

## Concrete Steps

1. Add `ws` and `@types/ws` dependencies to `packages/omnicore`.
2. Create adapter protocol types and hub server.
3. Update kernel to start/stop the adapter hub and route outbound actions.
4. Add CLI adapter client (`dev:adapter`) and update CLI control commands.
5. Integrate `packages/agent` in `reasoner.ts` and log tool execution events.
6. Remove internal channel trait and unused channel code.
7. Update README with adapter usage and CLI commands.
8. Run `pnpm run check-types` and `pnpm --filter @bbot/omnicore check-types`.

## Validation and Acceptance

- Starting the kernel exposes a WS port; a CLI adapter can connect and send messages without kernel restart.
- `omnicore status` shows last heartbeat and latest event sequence.
- `omnicore restart` writes a restart action event that the supervisor consumes.
- Agent responses are produced via `packages/agent`.

## Idempotence and Recovery

Changes are additive and isolated to OmniCore. If the adapter hub misbehaves, stop the kernel and restart; adapters can reconnect. To reset state, delete the SQLite DB.

## Artifacts and Notes

Expected adapter message shapes (JSON):

    {"type":"hello","adapterId":"cli","capabilities":["send_message","event_in"]}
    {"type":"event","event":{"type":"signal.inbound","actorId":"cli:local","traceId":"...","payload":{"kind":"message","text":"hi"}}}
    {"type":"action","action":{"type":"send_message","actorId":"cli:local","text":"hello"},"traceId":"..."}

## Interfaces and Dependencies

- Dependency: `ws` (server + client) and `@types/ws`.
- Adapter hub API:

    start(): Promise<void>
    stop(): Promise<void>
    emitAction(action, traceId, causationId): void

- CLI control API:

    omnicore status
    omnicore restart

Note: Update this plan as implementation proceeds, including progress timestamps and any changes in design decisions.
