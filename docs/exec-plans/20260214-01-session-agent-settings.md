# Session-Level Agent Settings and Prompt Profiles

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

The PLANS.md requirements live at `.agents/PLANS.md` from the repository root. This plan must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, every interface (WebUI, TUI, Telegram bot, and future Discord bot) can switch an agent’s operating mode at the session level, and that choice will reliably flow through the core daemon to the agent runtime. A user will be able to set a session’s prompt profile (coding vs free), model, thinking intensity, and MCP availability once, then create runs that automatically use those settings. They will also be able to override those settings per run when needed, including enabling or disabling MCP entirely and toggling specific MCP tools. Global configuration (such as model discovery and MCP discovery flags) will be stored in the existing `system_configs` table. They will be able to see what settings are active for a session, and the system will accept empty settings and fall back to defaults cleanly. This is visible by calling the new settings endpoint, then creating a run and observing in logs and run records that the chosen profile/model were applied and that MCP tools are either present or absent as configured.

## Progress

- [x] (2026-02-14 00:00Z) Created the initial ExecPlan with context, decisions, and an end-to-end plan.
- [ ] Add session-level agent settings to the database, protocol, and domain models (completed: none; remaining: schema, migration, type updates, serializers).
- [ ] Add MCP enable/disable and tool-level toggles to session/run settings (completed: none; remaining: schema, validation rules, filtering logic).
- [ ] Add run-level override fields to the database and protocol models (completed: none; remaining: schema, migration, type updates, serializers).
- [ ] Wire system-wide configuration (system_configs) into agent settings discovery and feature flags (completed: none; remaining: key definitions, lookups, usage in options endpoint).
- [ ] Expose a settings API that all clients can use to read and update session agent settings.
- [ ] Wire the dispatcher and agent runtime to honor session-level prompt profile, model, and thinking level.
- [ ] Update the SDK and the Telegram/TUI/WebUI clients to use the shared settings API (completed: none; remaining: SDK regen, client changes).
- [ ] Validate end-to-end behavior and document the observable results.

## Surprises & Discoveries

No surprises yet. Update this section as implementation proceeds.

## Decision Log

- Decision: Use session-level settings stored on `workspace_sessions` rather than per-run or per-user storage.
  Rationale: It matches the “mode switch” mental model and provides a single, transport-agnostic mechanism that all UIs can share.
  Date/Author: 2026-02-14, Codex

- Decision: Store settings as explicit columns (agent profile, model, thinking level) instead of only using the metadata JSON.
  Rationale: Typed columns are easier to validate, index, and expose cleanly through protocol schemas and SDKs.
  Date/Author: 2026-02-14, Codex

- Decision: Provide a shared “agent options” endpoint so clients can discover valid profiles, thinking levels, and model choices.
  Rationale: Prevents per-client hardcoding and keeps the selection UX consistent across interfaces.
  Date/Author: 2026-02-14, Codex

- Decision: Allow per-run overrides, but store them explicitly for reproducibility.
  Rationale: Users sometimes need a one-off run without changing the session defaults, and we need to be able to audit which settings were used for a run.
  Date/Author: 2026-02-14, Codex

- Decision: Session settings are optional; empty fields fall back to current defaults.
  Rationale: Avoids forcing configuration for casual runs and preserves the existing default behavior.
  Date/Author: 2026-02-14, Codex

- Decision: Prompt profiles remain strictly `coding` and `free`, where `free` is intended to be a “god-level” agent with no functional capability restrictions.
  Rationale: Keeps the profile surface small and matches the desired behavior model.
  Date/Author: 2026-02-14, Codex

- Decision: If a requested thinking level is not supported by the selected model, ignore that override and keep the runtime default.
  Rationale: The UI should avoid invalid selections, but the server must still be safe; keeping defaults is the least surprising behavior.
  Date/Author: 2026-02-14, Codex

- Decision: Model list discovery should call the provider base URL list-models endpoint for OpenAI, then enrich results with Models.dev metadata.
  Rationale: The base URL returns authoritative availability for the current API key, while Models.dev adds optional capability metadata; a fallback remains necessary for offline or non-OpenAI providers.
  Date/Author: 2026-02-14, Codex

- Decision: `AGENT_MODEL` remains the default model regardless of list discovery.
  Rationale: It is the existing required config and avoids behavior changes when discovery fails.
  Date/Author: 2026-02-14, Codex

- Decision: MCP settings are stored as a JSON settings object (not separate columns) to support per-server and per-tool toggles without schema churn.
  Rationale: MCP toggles require nested configuration (server + tool) that does not map cleanly to scalar columns.
  Date/Author: 2026-02-14, Codex

- Decision: MCP settings only reference server and tool names already defined in `AGENT_MCP_SERVERS`; secrets or connection details remain in env configuration.
  Rationale: Avoids persisting credentials in the database and keeps all connection details in one place.
  Date/Author: 2026-02-14, Codex

- Decision: MCP can be disabled globally per session or per run, and tool allow/deny lists are applied after server filtering.
  Rationale: Users need a safe, simple “off” switch and granular control when MCP is enabled.
  Date/Author: 2026-02-14, Codex

- Decision: Reuse the existing `system_configs` table and API for global agent settings discovery flags.
  Rationale: The table and endpoints already exist in the core daemon and SDK, so reusing them avoids schema churn.
  Date/Author: 2026-02-14, Codex

- Decision: Do not add dedicated audit records for settings changes beyond existing run and session entries.
  Rationale: The system already tracks runs and session entries; explicit audit trails can be added later if needed.
  Date/Author: 2026-02-14, Codex

## Outcomes & Retrospective

Not complete yet. This will be updated after the feature is implemented and validated.

## Context and Orientation

In this repo, a “session” is a row in the `workspace_sessions` table and is exposed through the Workspaces API. A “run” is a single prompt execution stored in `runs`. The core daemon (`apps/core-daemon`) is the only component that drives runs; all interfaces are thin transports that call its HTTP API. The agent runtime lives in `packages/agent`, where `runAgent` builds the system prompt and selects model and thinking level from environment config in `packages/agent/src/config.ts`. The current prompt is hard-wired to `packages/agent/src/prompts/gpt-5.2-codex-prompt.md`, but a free prompt was added at `packages/agent/src/prompts/gpt-5.2-codex-free-prompt.md` and can be selected via a profile override. The core daemon’s dispatcher (`apps/core-daemon/src/modules/runs/dispatcher.ts`) currently calls `runAgent` with the global config only.

Key files and how they connect:

`packages/database/schemas/index.ts` defines `workspace_sessions`, `runs`, and `system_configs`. This is the authoritative database schema for the core daemon.
`packages/protocol/src/schema/workspaces.ts` and `packages/protocol/src/schema/runs.ts` define the HTTP API request and response shapes. The SDK is generated from these schemas.
`apps/core-daemon/src/modules/workspaces` contains the Workspaces HTTP routes, persistence, and serialization.
`apps/core-daemon/src/modules/runs/dispatcher.ts` is where the agent is invoked and where session-level settings must be applied.
`packages/agent/src/system-prompt.ts` and `packages/agent/src/config.ts` build the system prompt and model config that the agent uses.
`apps/bot-telegram/src/api.ts` is the only client currently calling the Workspaces and Runs APIs. WebUI and TUI are present but currently minimal and do not call the API yet.

Terminology used in this plan:

“Prompt profile” means which base prompt is used to build the system prompt. For this change, valid values are `coding` and `free`, and `free` is considered an unrestricted, god-level mode.
“Thinking level” is a string that controls reasoning intensity in the agent runtime. Allowed values are `off`, `minimal`, `low`, `medium`, `high`, and `xhigh`. If a model does not support reasoning, any requested override must be ignored and the default used.
“Agent options” means a single API response that tells clients what profiles, models, and thinking levels are valid for selection.
“Run override” means optional settings provided at run creation time that take precedence over the session settings for that single run.
“MCP settings” means an optional object that can disable MCP entirely, allow or deny named MCP servers, and allow or deny named MCP tools.

## Plan of Work

First, add explicit session-level agent settings to the database schema. In `packages/database/schemas/index.ts`, add new columns on `workspace_sessions`: `agentProfile`, `agentModel`, and `agentThinkingLevel`. Define enums for `agent_profile` and `agent_thinking_level` using `pgEnum` to keep values stable. The thinking level enum must match the existing `ThinkingLevel` values used by the agent runtime. Create a migration that adds these columns with safe defaults (`agentProfile` default `coding`, `agentThinkingLevel` default `off`, and `agentModel` nullable). Update the schema typing and helpers as needed.

Add a new JSONB column `agentMcpSettings` on `workspace_sessions` to store MCP enable/disable and tool toggles. Keep it nullable so that the absence of settings means “use defaults.” The JSON shape should allow:

- `enabled`: boolean (global MCP on/off)
- `allowServers`: string[] (optional allowlist)
- `denyServers`: string[] (optional denylist)
- `allowTools`: string[] (optional allowlist, using `serverName:toolName` format)
- `denyTools`: string[] (optional denylist, using `serverName:toolName` format)

This stores only names, not connection details.

Second, add run-level override storage to the database. In `packages/database/schemas/index.ts`, add optional columns on `runs` for `agentProfile`, `agentModel`, and `agentThinkingLevel`. Add a nullable JSONB column `agentMcpSettings` to allow per-run MCP overrides. These fields are nullable so they only apply when a run explicitly overrides session settings. Add a migration that adds these columns without defaults.

Third, make the protocol and domain models aware of these new session and run settings. Add an `agentSettings` object to `workspaceResponse` in `packages/protocol/src/schema/workspaces.ts`. The `agentSettings` object should include `profile`, `model`, `thinkingLevel`, and `mcp`. Update `CreateWorkspaceBody` to accept `agentSettings` (optional) so sessions can be created with a default mode. Add an optional `agentSettings` object to `createRunBody` in `packages/protocol/src/schema/workspaces.ts` to allow per-run overrides. Update `packages/protocol/src/schema/runs.ts` and run serialization to surface any run-level settings that were used. Update `packages/domain/src/index.ts` to add corresponding optional fields to `WorkspaceSession` and `Run`.

Fourth, add an API for reading and updating session settings. Add a `PATCH /workspaces/:id/settings` route in `apps/core-daemon/src/modules/workspaces/index.ts` that accepts a new `updateWorkspaceSettingsBody` schema from `packages/protocol`. This handler should validate the requested profile, model, thinking level, and MCP settings before writing them to `workspace_sessions`. The response should be the updated workspace serialized with the new settings. Also add a `GET /agent/options` route in a new module (for example `apps/core-daemon/src/modules/agent-options`) that returns:

the list of prompt profiles (`coding`, `free`);
the list of thinking levels (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`);
the list of available models and the default model;
the currently configured provider.
MCP server names and any discoverable MCP tool names (if tool discovery is enabled).

Model discovery must be deterministic and safe. If the provider is OpenAI and outbound HTTP is allowed, call the configured base URL list-models endpoint (`GET /v1/models`) using the same credentials as the agent runtime to obtain the authoritative model IDs for the current credentials. Then fetch the Models.dev catalog from `https://models.dev/api.json`, match by model ID, and attach any available metadata. If either request fails, fall back to the system config key `agent.availableModels` (array of strings) and then to `AGENT_MODEL` as a single-item list. The `defaultModel` in the options response must always be `AGENT_MODEL`. The endpoint should also include a `reasoningSupported` flag per model if it can be derived from `getModel(provider, model)` without network calls. If reasoning support cannot be determined, return `false` and let clients default to `off`.

MCP discovery should be safe and configurable. Add a system config key `agent.mcpToolDiscovery` (boolean) to control whether the agent-options endpoint actually connects to MCP servers to list tools. When disabled, only list server names from `AGENT_MCP_SERVERS` without tools. When enabled, connect to each configured server and list tool names for display.

Fifth, wire session settings into run execution. In `apps/core-daemon/src/modules/runs/dispatcher.ts`, after loading the workspace and the run, resolve the effective settings by applying run overrides over session defaults. Apply those effective settings when calling `runAgent`. The override should be applied by extending the config object passed to `runAgent` (in `packages/agent/src/index.ts`) so that:

`promptProfile` chooses between the coding and free prompts;
`model` overrides the model name;
`thinkingLevel` overrides the reasoning intensity.
`mcpSettings` determines whether MCP servers are connected and which tools are exposed.

If a thinking level is requested but the selected model does not support reasoning, ignore that override and keep the runtime default. The dispatcher should not throw; it should continue the run with the safe default. This rule must be documented in the response from `GET /agent/options` so client UIs can avoid the invalid selection.

Sixth, ensure the SDK and clients can use the settings. After protocol changes, regenerate the SDK (`pnpm run workflow:sdk`) and update the Telegram bot client to call the settings endpoint. Provide minimal commands in the bot (for example `/mode coding`, `/mode free`, `/model <name>`, `/think <level>`, `/mcp on|off`, `/mcp-tool enable <server:tool>`, `/mcp-tool disable <server:tool>`) that call `PATCH /workspaces/:id/settings` and acknowledge the update. Extend the run-creation call to accept optional run overrides. For the TUI and WebUI, add a simple settings panel or command menu that reads `GET /agent/options`, shows the available choices (including MCP servers/tools if available), and calls the same settings endpoint. If those UIs are not yet fully implemented, leave a clear TODO in their entry points pointing to the shared API and the SDK types.

Finally, update serialization and tests. `apps/core-daemon/src/modules/workspaces/serialize.ts` must include `agentSettings` in the workspace response. Add or update unit tests for `buildSystemPrompt` (already in `packages/agent/src/__tests__/system-prompt.test.ts`) to verify that `promptProfile` overrides select the free prompt. Add core-daemon tests to validate settings updates and invalid combinations (at least for thinking level vs model reasoning support). These tests should run using the existing test tooling in the repo.

## Concrete Steps

Run all commands from the repository root unless stated otherwise.

1. Update the Drizzle schema and generate migrations.

   - Edit `packages/database/schemas/index.ts` to add the new enums and columns on `workspace_sessions` and `runs`, including `agentMcpSettings` JSONB.
   - Run:
       pnpm run db:generate
       pnpm run workflow:dbml
       pnpm run db:migrate

   Expected result: a new migration file exists in `packages/database/migrations` and the database schema includes the new columns.

2. Update protocol and domain types.

   - Edit `packages/protocol/src/schema/workspaces.ts` to add `agentSettings` to workspace responses and creation/update bodies.
   - Edit `packages/domain/src/index.ts` to include the new fields on `WorkspaceSession`.
   - Run:
       pnpm run workflow:sdk

   Expected result: SDK types now include the new settings objects and API endpoints.

3. Add the settings endpoints and options endpoint in core-daemon.

   - Edit `apps/core-daemon/src/modules/workspaces/index.ts` to add `PATCH /workspaces/:id/settings`.
   - Add a new module in `apps/core-daemon/src/modules/agent-options` (name can vary, but keep it simple) and register it in `apps/core-daemon/src/app.ts`.
   - Update `apps/core-daemon/src/modules/workspaces/service.ts` to persist settings and validate updates.

4. Wire session settings into run execution.

   - Update `apps/core-daemon/src/modules/runs/dispatcher.ts` to apply session-level overrides when calling `runAgent`.
   - Update `packages/agent/src/index.ts` and `packages/agent/src/config.ts` if new override fields are needed.

5. Update serialization and client usage.

   - Edit `apps/core-daemon/src/modules/workspaces/serialize.ts` to include settings in the response.
   - Update `apps/bot-telegram/src/api.ts` and command handling to support settings changes.
   - Add minimal settings UI or command hooks in `apps/tui` and `apps/webui` (or TODOs if those UIs are still stubs).

6. Run the mandatory checks.

   - Run:
       pnpm run check-types

## Validation and Acceptance

The change is accepted when all of the following are true:

1. Creating or updating a workspace session with a profile of `free` and a custom model succeeds, and `GET /workspaces/:id` returns those settings.
2. A run created after the update uses the selected prompt profile and model. Evidence includes a run event or logs showing “BBCodex Free” when the free profile is selected.
3. A run created with per-run overrides uses those overrides even if the session defaults differ.
4. Setting an unsupported thinking level for a model without reasoning keeps the default behavior and does not crash.
5. Disabling MCP at the session level removes MCP tools from the available tool list during a run.
6. Disabling a specific MCP tool prevents that tool from appearing in the available tool list even when MCP is enabled.
4. `GET /agent/options` returns valid profiles, thinking levels, the default model, and available model list.
5. The Telegram bot can update session settings through user commands and confirms the new values in its reply.
6. `pnpm run check-types` passes.

## Idempotence and Recovery

Database migrations must be idempotent. If the migration fails, rerun `pnpm run db:migrate` after fixing the migration. If the schema changes are already applied, rerunning the migration and dbml workflow should be safe. The settings endpoint is safe to call multiple times; it only updates stored values.

If a model override causes runtime failures, revert the session settings to the default model using the settings endpoint. This does not require database rollback.

## Artifacts and Notes

Example expected response from `GET /agent/options` (shape only, values may differ):

    {
      "provider": "openai",
      "defaultModel": "gpt-5.2-codex",
      "profiles": ["coding", "free"],
      "thinkingLevels": ["off", "minimal", "low", "medium", "high", "xhigh"],
      "models": [
        { "name": "gpt-5.2-codex", "reasoningSupported": true },
        { "name": "gpt-4.1-mini", "reasoningSupported": false }
      ]
    }

Example expected response from `GET /workspaces/:id` (new fields only):

    {
      "agentSettings": {
        "profile": "free",
        "model": "gpt-5.2-codex",
        "thinkingLevel": "medium",
        "mcp": {
          "enabled": true,
          "denyTools": ["filesystem:delete"]
        }
      }
    }

Example expected fields on a run response when overrides are used (new fields only):

    {
      "agentSettings": {
        "profile": "coding",
        "model": "gpt-4.1-mini",
        "thinkingLevel": "off"
      }
    }

## Interfaces and Dependencies

Database: `packages/database/schemas/index.ts` with a migration in `packages/database/migrations`.
Protocol: `packages/protocol/src/schema/workspaces.ts` and any new schema file for agent options.
Core daemon: Workspaces module, a new agent-options module, and the run dispatcher.
Agent runtime: `packages/agent/src/index.ts`, `packages/agent/src/system-prompt.ts`, and `packages/agent/src/config.ts`.
SDK: Regenerated via `pnpm run workflow:sdk`.
Clients: Telegram bot in `apps/bot-telegram`, and later the TUI/WebUI when they are ready.

If the OpenAI list-models call is unavailable, do not add a new network dependency beyond the Models.dev fetch; use `AGENT_AVAILABLE_MODELS` and `AGENT_MODEL` as the authoritative list.

Plan update note: Updated to reuse existing system-configs table and API instead of adding a new one.
