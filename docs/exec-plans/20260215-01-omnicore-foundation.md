# Build OmniCore v0 (Kernel + Traits + Event Log + Self-Restart)

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

PLANS.md is located at `/Users/wibus/dev/bbot/.agents/PLANS.md`. This document must be maintained in accordance with it.

## Purpose / Big Picture

The goal is to introduce a brand-new, standalone OmniCore package that embodies the AI-native architecture: a kernel that is channel-agnostic, event-sourced, trait-driven, self-evolving, and capable of autonomous heartbeat-driven work. After this change, a user can start OmniCore, see it emit heartbeat events without any bot connected, send a message via a CLI channel, observe the kernel react through the event log, and trigger an automatic restart through an action without human intervention. The working behavior is demonstrated by running the new package’s scripts and observing the event log and console output.

## Progress

- [x] (2026-02-15 00:15Z) Created initial ExecPlan skeleton and defined the OmniCore v0 goals.
- [x] (2026-02-15 00:40Z) Scaffolded new `packages/omnicore` workspace package with TS config, scripts, README, and mission file.
- [x] (2026-02-15 00:55Z) Implemented event model, append-only JSONL event log, and materialized context view rebuild.
- [x] (2026-02-15 01:05Z) Implemented kernel loop with heartbeat emission, mission ingestion, action execution, and event recording.
- [x] (2026-02-15 01:10Z) Implemented traits: CLI channel, heartbeat driver, local sandbox runner, and file-based memory stub.
- [x] (2026-02-15 01:15Z) Implemented supervisor for auto-restart on restart action.
- [x] (2026-02-15 01:20Z) Added CLI entrypoint, scripts, and package README with run instructions.
- [x] (2026-02-15 01:35Z) Ran `pnpm --filter @bbot/omnicore check-types` successfully.
- [ ] (2026-02-15 01:30Z) Ran `pnpm run check-types` (failed: Turbo crashed with system-configuration dynamic_store NULL object panic).
- [x] (2026-02-15 01:40Z) Updated ExecPlan with progress, discoveries, and decisions through initial implementation.

## Surprises & Discoveries

- Observation: `pnpm run check-types` fails because Turbo crashes on macOS with a `system-configuration` dynamic store panic.
  Evidence: Turbo report at `/var/folders/c7/r4_0jrd91zg4n58001d0pl3r0000gn/T/report-694c4f28-7eae-497f-a18a-ebbedf43a7b8.toml` shows `Attempted to create a NULL object` in `system-configuration-0.6.1`.

## Decision Log

- Decision: Build OmniCore as a new workspace package under `packages/omnicore` rather than modifying existing modules.
  Rationale: The user explicitly requested a clean, destructive reboot without compatibility constraints and no reliance on existing code.
  Date/Author: 2026-02-15 (assistant)
- Decision: Use a rule-based reasoner by default and enable optional LLM reasoning when `OMNICORE_MODEL` is set.
  Rationale: This keeps the kernel functional without external model configuration while still aligning with AI-native goals when a model is provided.
  Date/Author: 2026-02-15 (assistant)
- Decision: Keep mission text out of the event payload and read it at reasoning time.
  Rationale: Simplifies the initial implementation while still enabling autonomous heartbeat behavior; event payload enrichment can be added later.
  Date/Author: 2026-02-15 (assistant)

## Outcomes & Retrospective

OmniCore v0 now exists as a standalone package with event log, kernel loop, traits, supervisor auto-restart, and a runnable CLI. The kernel emits heartbeat events without any bot attached and can execute basic actions through a CLI channel and sandbox. The package-level typecheck passes, while the repo-level `pnpm run check-types` currently fails because Turbo crashes on this environment.

## Context and Orientation

The repository is a pnpm + Turborepo monorepo. New packages live under `packages/`. TypeScript configuration is standardized via `@bbot/typescript-config` and package scripts typically expose `build`, `check-types`, and `test`. This plan introduces a new package `packages/omnicore` that does not import or depend on current app or core packages, except for common workspace tooling and the pi-mono runtime library. The OmniCore package will provide:

- `event` definitions and an append-only JSONL event log.
- `kernel` orchestration that processes events and dispatches actions to traits.
- `traits` as plugin-like interfaces with a CLI channel, heartbeat, sandbox runner, and memory stub.
- `supervisor` responsible only for restarting the kernel when a restart action appears in the event log.

Terminology in this plan:

- “Event”: a single immutable record describing a signal or action. Events are the only source of truth.
- “Event log”: append-only JSONL file storing events in order.
- “Materialized view”: a derived JSON file rebuilt from the event log to give fast access to recent context.
- “Trait”: an interface for a specific capability (channel IO, heartbeat, sandbox execution, memory).
- “Kernel”: the core logic that consumes events and produces actions without knowledge of external channels.
- “Supervisor”: a minimal process that restarts the kernel when requested by the event stream.

## Plan of Work

We will create a new `packages/omnicore` workspace package with its own `package.json`, `tsconfig.json`, and `README.md`, plus a `MISSION.md` file that the kernel reads on heartbeats. We will implement the event model in `packages/omnicore/src/events.ts` and a JSONL event log in `packages/omnicore/src/event-log.ts`. The kernel (`packages/omnicore/src/kernel.ts`) will:

- Append incoming events to the event log.
- Emit heartbeat events on an interval.
- Read `MISSION.md` content during heartbeats and include it in internal signals.
- Generate actions (initially simple deterministic rules; optionally LLM integration via pi-mono) and dispatch them to traits.

Traits will live in `packages/omnicore/src/traits/` and include:

- `cli-channel.ts`: reads stdin and emits inbound message events; writes outbound messages to stdout.
- `heartbeat.ts`: a simple interval-based emitter for internal signal events.
- `sandbox-local.ts`: executes commands in a sandbox root directory and returns stdout/stderr.
- `memory-fs.ts`: a minimal file-backed store for “memory” data (stub, but with clear interface).

We will implement action execution in `packages/omnicore/src/actions.ts` or in the kernel directly. Each action will produce both `action.requested` and `action.executed` events to preserve event sourcing.

A `supervisor` process (`packages/omnicore/src/supervisor.ts`) will run the kernel as a child process, tail the event log for restart actions, and restart the kernel automatically. The kernel will also exit gracefully when it emits a restart action to allow fast cycle time. The supervisor will support configurable kernel command/args via environment variables, enabling development (`tsx`) and production (compiled JS) modes.

Finally, we will expose a CLI entrypoint in `packages/omnicore/src/cli.ts` with commands for `kernel` and `supervisor` and provide scripts to run them. We will run `pnpm run check-types` and show a minimal demo transcript in the ExecPlan.

## Concrete Steps

1. Create `packages/omnicore` with `package.json`, `tsconfig.json`, `README.md`, and `MISSION.md`.
2. Add `src/events.ts` defining `Event`, `EventType`, `Action`, and event creation helpers.
3. Add `src/event-log.ts` implementing JSONL append/read/tail with safe fs handling.
4. Add trait interfaces in `src/traits/types.ts` and implementations in `src/traits/*.ts`.
5. Implement `src/kernel.ts` to wire traits, emit heartbeat signals, process inbound events, and append actions.
6. Implement `src/supervisor.ts` to spawn kernel and restart on restart action.
7. Implement `src/cli.ts` to parse commands and run kernel/supervisor.
8. Update `README.md` with run instructions and demo expectations.
9. Run `pnpm run check-types` at repo root.
10. Update Progress, Decision Log, and Outcomes in this ExecPlan.

## Validation and Acceptance

A human should be able to:

- Run `pnpm --filter @bbot/omnicore build` then `pnpm --filter @bbot/omnicore supervisor` and observe the kernel emitting heartbeat events into the event log without any inbound message.
- Run `pnpm --filter @bbot/omnicore kernel` and type a line into stdin; observe a `signal.inbound` event followed by `action.requested` and `action.executed` entries in the event log, and see a response printed to stdout.
- Trigger a restart by typing `!restart` in the CLI channel, observe a `action.requested` restart event, and see the supervisor restart the kernel (evident in console logs).

The `pnpm run check-types` command must succeed from the repository root.

## Idempotence and Recovery

All steps are additive. Re-running the package scripts should not corrupt state; the event log is append-only. If a change causes the kernel to crash, the supervisor should restart it. If the event log becomes invalid, deleting the data directory allows a clean restart (this should be explicitly documented in the README).

## Artifacts and Notes

Expected event log snippet (illustrative, not exact IDs):

    {"id":"...","type":"signal.internal","payload":{"kind":"heartbeat","mission":"..."}}
    {"id":"...","type":"signal.inbound","payload":{"kind":"message","text":"hello"}}
    {"id":"...","type":"action.requested","payload":{"action":{"type":"send_message","text":"..."}}}
    {"id":"...","type":"action.executed","payload":{"action":{"type":"send_message"},"result":{"ok":true}}}

## Interfaces and Dependencies

New package dependencies:

- `@mariozechner/pi-ai` for optional LLM reasoning (pi-mono runtime).
- `@bbot/typescript-config` for TypeScript configuration.
- `tsx` for development scripts.
- Node built-ins: `fs`, `fs/promises`, `path`, `crypto`, `readline`, `child_process`.

Key interfaces to define:

In `packages/omnicore/src/events.ts`, define:

    export type EventType = "signal.inbound" | "signal.internal" | "action.requested" | "action.executed";
    export interface Event { id: string; type: EventType; timestamp: string; actorId: string | null; traceId: string; causationId?: string; payload: Record<string, unknown>; }
    export type ActionType = "send_message" | "run_bash" | "write_file" | "restart";

In `packages/omnicore/src/traits/types.ts`, define:

    export interface ChannelTrait { kind: "channel"; id: string; start: (emit: (event: Event) => Promise<void>) => () => void; sendMessage: (input: { actorId: string; text: string; traceId: string }) => Promise<void>; }
    export interface HeartbeatTrait { kind: "heartbeat"; start: (emit: (event: Event) => Promise<void>) => () => void; }
    export interface SandboxTrait { kind: "sandbox"; run: (input: { command: string }) => Promise<{ stdout: string; stderr: string; exitCode: number }>; }
    export interface MemoryTrait { kind: "memory"; append: (input: { key: string; value: string }) => Promise<void>; read: (input: { key: string }) => Promise<string | null>; }

In `packages/omnicore/src/kernel.ts`, define:

    export class OmniKernel { constructor(config: KernelConfig); start(): Promise<void>; stop(): Promise<void>; }

In `packages/omnicore/src/supervisor.ts`, define:

    export async function runSupervisor(config: SupervisorConfig): Promise<void>;



Note: Update this plan as implementation proceeds, including progress timestamps and any changes in design decisions.
