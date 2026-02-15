# Add Session Archiving and Resume Pagination for Telegram Bot

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

PLANS.md reference: follow `/.agents/PLANS.md` from the repository root for all ExecPlan requirements and update rules.

## Purpose / Big Picture

After this change, Telegram users can archive the current session with a `/archive` command and browse past sessions via a paginated `/resume` list. Archived sessions should no longer clutter the default list. This is visible by running the Telegram bot, creating multiple sessions, archiving one, and observing that the archived session disappears from the `/resume` list while pagination controls allow navigating beyond the first page.

## Progress

- [x] (2026-02-13 00:00Z) Reviewed Telegram bot commands, workspace search flow, and core-daemon workspace APIs to locate the session list and update points.
- [x] (2026-02-13 00:20Z) Added an archive endpoint in the core-daemon and persist `status = archived` for a workspace session.
- [x] (2026-02-13 00:30Z) Extended workspace search to accept pagination and status filters, and wired `/resume` to use Next/Prev navigation with a token cache.
- [x] (2026-02-13 00:40Z) Regenerated OpenAPI and SDK types to reflect the new endpoint and query parameters.
- [ ] Validate behavior manually (and via any available tests) to confirm archiving and pagination work end-to-end.

## Surprises & Discoveries

- Observation: `pnpm --filter @bbot/core-daemon run openapi:generate` failed in the sandbox due to an EPERM error when `tsx` attempted to open its IPC socket in the default temp directory.
  Evidence: `Error: listen EPERM: operation not permitted ... tsx-501/26304.pipe`.

## Decision Log

- Decision: Use a new `POST /workspaces/:id/archive` endpoint to archive a session rather than deleting it.
  Rationale: The database already models `status` with `archived`, so this is a safe, reversible state change consistent with existing schema.
  Date/Author: 2026-02-13 (Codex)

- Decision: Implement pagination via `limit` and `offset` query parameters on `/workspaces/search`.
  Rationale: The existing endpoint already returns ordered lists and the database query can naturally apply `LIMIT/OFFSET` without additional tables or cursors.
  Date/Author: 2026-02-13 (Codex)

- Decision: Use a short-lived in-memory token to carry `/resume` search context across pagination callbacks.
  Rationale: Telegram callback data length is constrained; storing the search query by token avoids oversized callback payloads while keeping UX simple.
  Date/Author: 2026-02-13 (Codex)

- Decision: Filter `/resume` results to `status=active` so archived sessions disappear by default.
  Rationale: The new `/archive` command is meant to remove sessions from the standard list without deleting data.
  Date/Author: 2026-02-13 (Codex)

- Decision: Keep the Telegram resume page size at 12 sessions per page.
  Rationale: This matches the prior UX while still leaving room for pagination controls.
  Date/Author: 2026-02-13 (Codex)

- Decision: Change `/archive` to show a selectable list instead of auto-archiving the current session.
  Rationale: The user asked to choose which session to archive, so the bot now mirrors the `/resume` list UX.
  Date/Author: 2026-02-13 (Codex)

- Decision: Add a confirmation step before archiving a session from the list.
  Rationale: Avoid accidental archiving from a tap; confirmation keeps the action explicit.
  Date/Author: 2026-02-13 (Codex)

## Outcomes & Retrospective

- Pending validation and user confirmation of behavior.

## Context and Orientation

The Telegram bot is implemented in `apps/bot-telegram/src/bot.ts`, with commands living under `apps/bot-telegram/src/commands/`. It calls the core API through `apps/bot-telegram/src/api.ts`. Workspace sessions are stored in the database table `workspace_sessions` defined in `packages/database/schemas/index.ts` and served by the core-daemon’s workspace module in `apps/core-daemon/src/modules/workspaces/index.ts` with database logic in `apps/core-daemon/src/modules/workspaces/service.ts`. Request and response schemas are defined in `packages/protocol/src/schema/workspaces.ts` and used by core-daemon routes for validation; OpenAPI and SDK types are generated from these routes.

In this repository, a “workspace session” represents a user’s conversation context. “Archiving” means setting the workspace session status to `archived` so it no longer appears in the default list. “Pagination” means returning a fixed number of sessions per request and allowing navigation through pages using `limit` and `offset` in the search API.

## Plan of Work

First, add a new archive service method in `apps/core-daemon/src/modules/workspaces/service.ts` that updates the `workspace_sessions` record to `status = archived`. Then expose a new `POST /workspaces/:id/archive` route in `apps/core-daemon/src/modules/workspaces/index.ts` that validates the path, archives the session, and returns the updated workspace response. Next, extend `packages/protocol/src/schema/workspaces.ts` to accept `limit`, `offset`, and `status` in the search query schema. Update the workspace search service to apply these filters and pagination. After the API changes, update the Telegram bot: add the `/archive` command to `apps/bot-telegram/src/commands.ts`, implement the handler in `apps/bot-telegram/src/bot.ts`, and enhance `/resume` to use pagination with Next/Prev buttons backed by a small in-memory token cache. Finally, regenerate OpenAPI and SDK types so downstream clients stay consistent with the new API surface.

## Concrete Steps

1. Edit `packages/protocol/src/schema/workspaces.ts` to add optional `status`, `limit`, and `offset` to `workspaceSearchQuery`.
2. Update `apps/core-daemon/src/modules/workspaces/service.ts` to:
   - Accept `status`, `limit`, and `offset` in `searchWorkspaces`.
   - Add a new `archiveWorkspace` function that updates a workspace status to `archived`.
3. Update `apps/core-daemon/src/modules/workspaces/index.ts` to:
   - Add a `POST /workspaces/:id/archive` route.
   - Use `workspaceResponse` for success and `errorResponse` for failure.
4. Update the Telegram bot:
   - Add `/archive` to `apps/bot-telegram/src/commands.ts`.
   - Add an `archiveWorkspace` API helper in `apps/bot-telegram/src/api.ts`.
   - Add a `/archive` handler and paginated `/resume` flow in `apps/bot-telegram/src/bot.ts`.
5. Regenerate schemas and SDK:
   - From repo root, run:
       pnpm --filter @bbot/core-daemon run openapi:generate
       pnpm --filter @bbot/sdk run sdk:generate
6. Validate by running the bot and manually verifying:
   - `/archive` archives the current session and removes it from `/resume`.
   - `/resume` shows navigation buttons that change pages.

## Validation and Acceptance

Acceptance means:
- Creating multiple sessions in Telegram yields a `/resume` list limited to the page size with Next/Prev controls.
- Clicking Next or Prev updates the list without errors.
- Running `/archive` while a session is active updates the session status and removes it from the default `/resume` list.

Suggested checks:
- Start core-daemon and the Telegram bot, then use `/new`, send a message, repeat, and confirm pagination.
- Use `/archive` on the current session and confirm it no longer appears in the `/resume` list.

## Idempotence and Recovery

Re-running the OpenAPI/SDK generation commands is safe and should only update generated files. If a route or schema change causes validation errors, revert the specific schema edits and re-run generation to restore consistency. Archiving is a reversible state change; if needed, the status can be flipped back to `active` by a one-off database update.

## Artifacts and Notes

No artifacts yet. Capture any relevant diffs or command output here as the work proceeds.

## Interfaces and Dependencies

The new API endpoint is:

    POST /workspaces/:id/archive

It returns the same shape as `workspaceResponse`. The search endpoint gains optional query parameters:

    GET /workspaces/search?chatId=...&userId=...&status=active&limit=12&offset=24

The Telegram bot will call this endpoint with `status=active` to keep archived sessions hidden in the default list.

---
Change log: initial ExecPlan created (2026-02-13) to cover `/archive` command and `/resume` pagination work.
Change log: updated progress, decisions, and discoveries after implementing core-daemon changes, bot pagination, and OpenAPI/SDK generation.
Change log: updated context to reflect command modules moved under `apps/bot-telegram/src/commands/`.
