# Refactor Telegram Bot Commands into Modules

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

PLANS.md reference: follow `/.agents/PLANS.md` from the repository root for all ExecPlan requirements and update rules.

## Purpose / Big Picture

After this change, each Telegram bot command lives in its own file under a `commands` folder, similar to how the agent tools are organized. This reduces the size of `apps/bot-telegram/src/bot.ts`, makes commands easier to reason about independently, and keeps command registration consistent. The user-visible behavior does not change; the same commands still exist and operate as before.

## Progress

- [x] (2026-02-13 01:10Z) Reviewed the existing bot command handlers and agent tools folder structure to mirror the layout.
- [x] (2026-02-13 01:40Z) Created `apps/bot-telegram/src/commands/` with per-command modules and shared helpers.
- [x] (2026-02-13 01:55Z) Updated `apps/bot-telegram/src/bot.ts` to register command modules and removed inline command handlers.
- [ ] Validate behavior manually (start bot, check `/help`, `/resume`, `/archive`, and message handling).

## Surprises & Discoveries

- None observed.

## Decision Log

- Decision: Model command modules after `packages/agent/src/tools` with `createXCommand()` factories returning a `{ command, description, register }` shape.
  Rationale: This mirrors the tooling pattern the user referenced and keeps registration centralized.
  Date/Author: 2026-02-13 (Codex)

- Decision: Keep non-command message handlers (`message:text`, `message`) in `bot.ts`.
  Rationale: These are general message handlers rather than discrete commands, and keeping them in `bot.ts` avoids creating an extra abstraction layer.
  Date/Author: 2026-02-13 (Codex)

## Outcomes & Retrospective

- Pending validation. The code now follows a modular command structure and should preserve existing behavior.

## Context and Orientation

The Telegram bot entry point is `apps/bot-telegram/src/bot.ts`. Commands were previously implemented inline in that file and command metadata lived in `apps/bot-telegram/src/commands.ts`. This refactor replaces the single file with a `commands/` folder where each command is a separate module. Command registration is handled by `apps/bot-telegram/src/commands/index.ts` and the help command uses the assembled command list.

## Plan of Work

Create `apps/bot-telegram/src/commands/` and move each command (`start`, `help`, `new`, `fork`, `resume`, `cancel`, `archive`, `pull`) into its own file. Add shared helpers in `commands/utils.ts` and pagination constants in `commands/constants.ts`. Update `bot.ts` to build the command list and register them through a `createCommandModules()` factory, leaving only general message handlers in `bot.ts`. Remove the old `commands.ts` file.

## Concrete Steps

1. Create `apps/bot-telegram/src/commands/types.ts` with shared command types.
2. Implement per-command files under `apps/bot-telegram/src/commands/`.
3. Add `apps/bot-telegram/src/commands/index.ts` to export `createCommandModules()`.
4. Update `apps/bot-telegram/src/bot.ts` to build `commandList` and register the modules.
5. Remove `apps/bot-telegram/src/commands.ts`.

## Validation and Acceptance

Run the Telegram bot and validate:
- `/help` shows the same command list as before.
- `/resume` and `/archive` pagination still works.
- Normal message flow still triggers runs.

Acceptance is satisfied when these behaviors remain unchanged and the code compiles with the new module layout.

## Idempotence and Recovery

These changes are file-local and can be re-run safely. If the refactor causes regressions, revert `apps/bot-telegram/src/bot.ts` and restore the old `commands.ts` file.

## Artifacts and Notes

No external artifacts produced. The main artifacts are the new command files under `apps/bot-telegram/src/commands/`.

## Interfaces and Dependencies

Each command module exports:

    export const createXCommand = (): CommandModule => ({ ... })

`CommandModule` is defined in `apps/bot-telegram/src/commands/types.ts` and includes `command`, `description`, and `register(context)` fields. The command registry in `apps/bot-telegram/src/commands/index.ts` returns an array of these modules.

---
Change log: initial ExecPlan created (2026-02-13) for command module refactor.
