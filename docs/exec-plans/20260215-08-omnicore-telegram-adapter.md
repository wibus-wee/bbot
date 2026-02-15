# Omnicore Telegram adapter app and shared adapter client

This ExecPlan is a living document. The sections Progress, Surprises and Discoveries, Decision Log, and Outcomes and Retrospective must be kept up to date as work proceeds.

This plan follows .agents/PLANS.md in the repository root and must be maintained in accordance with it.

## Purpose / Big Picture

After this change, the system can accept Telegram messages through a dedicated app, forward them into OmniCore as events, and send kernel responses back to Telegram chats. This also introduces a shared AdapterClient in packages/omnicore so multiple adapters can reuse connection logic. The result is observable by running the kernel, starting the Telegram app, and sending a message to the bot to receive a reply.

## Progress

- [x] (2026-02-15 12:30Z) Implemented a shared AdapterClient in packages/omnicore and refactored the CLI adapter to use it.
- [x] (2026-02-15 12:30Z) Added omnicore data directory helpers for reuse and exported them from the omnicore package.
- [x] (2026-02-15 12:30Z) Created the apps/bot-telegram app with a long polling Bot API client, command handling, and session persistence.
- [x] (2026-02-15 12:30Z) Updated shared env keys and omnicore README to document the Telegram adapter.
- [x] (2026-02-15 12:35Z) Ran pnpm run check-types; it failed because turbo could not resolve workspaces due to a missing packageManager field in package.json.
- [ ] Perform a manual end to end check by starting the kernel and the Telegram adapter and sending a message to the bot.

## Surprises & Discoveries

- Observation: pnpm run check-types failed before type checking because turbo requires a packageManager field.
  Evidence: turbo reported Missing packageManager field in package.json.

## Decision Log

- Decision: Choose option A and place AdapterClient and data directory helpers in packages/omnicore for reuse.
  Rationale: This keeps WebSocket reconnect logic and data directory resolution consistent across adapters without duplicating code.
  Date/Author: 2026-02-15, Wee.

## Outcomes & Retrospective

The Telegram adapter app and shared adapter client are implemented. Type checking could not run because turbo requires a packageManager field in package.json, and manual Telegram flow verification is still pending.

## Context and Orientation

OmniCore exposes a WebSocket adapter hub that accepts adapter connections and routes events and actions. The hub logic lives at packages/omnicore/src/adapters/hub.ts, the adapter protocol is defined at packages/omnicore/src/adapters/protocol.ts, and the CLI adapter is at packages/omnicore/src/adapters/cli-adapter.ts. The kernel is started through packages/omnicore/src/cli.ts and listens on port 8787 by default. Session and event types are defined in packages/omnicore/src/events.ts.

This change introduces a new app under apps/bot-telegram that talks to the Telegram Bot API using long polling and forwards messages into OmniCore as signal.inbound events. Session mappings from Telegram chat id to OmniCore session id are stored in .omnicore/telegram-sessions.json. The data directory is resolved using the same rules as the kernel, honoring OMNICORE_DATA_DIR and OMNICORE_ROOT.

Code style differs by package: omnicore uses semicolons, while shared and the new app are semicolonless. Node 18 or newer is required for the built in fetch.

## Plan of Work

First, add a reusable AdapterClient class in packages/omnicore/src/adapters/client.ts that manages the WebSocket lifecycle, reconnect backoff, and pending message queue. Refactor packages/omnicore/src/adapters/cli-adapter.ts to use this class for connection, event sending, and action handling. Export AdapterClient from packages/omnicore/src/index.ts so apps can import it from the package root.

Next, add helper functions in packages/omnicore/src/config.ts to resolve the OmniCore root and data directory. Use these helpers inside loadKernelConfig and loadSupervisorConfig to avoid duplicate logic, and export the helpers through the omnicore package for adapter apps.

Then, create apps/bot-telegram with package.json, tsconfig.json, turbo.json, and src/index.ts. The app should load BOT_TOKEN and optional settings from a .env file, connect to the adapter hub using AdapterClient, and poll the Telegram Bot API with getUpdates. It must translate Telegram text messages into signal.inbound events with session ids, persist chat to session mappings, and handle outbound send_message and send_status actions. Provide the commands /start, /help, /session, /new, and /use to manage sessions.

Finally, update packages/shared/src/env/keys.ts to include OMNICORE environment keys while keeping existing BOT_TOKEN and CORE_API keys for compatibility. Update packages/omnicore/README.md to document how to configure and run the Telegram adapter with ASCII only text and no backticks.

## Concrete Steps

From the repository root, create apps/bot-telegram and add the new TypeScript entry point and configuration files. Ensure the adapter uses long polling with a timeout of about 30 seconds and logs connection errors without leaking bot tokens or message contents.

Implement session persistence at .omnicore/telegram-sessions.json with atomic writes by writing to a temporary file and renaming it. If the JSON file is corrupt, rename it to a timestamped backup and continue with an empty store.

Run the following command from the repository root to check types:

    pnpm run check-types

Expected result is a clean exit or a clear error that can be addressed. Record any failures and adjust code as needed.

## Validation and Acceptance

Start the kernel using the existing supervisor and run the Telegram adapter in another terminal. In Telegram, send /start to the bot and confirm a help response. Send a normal text message and confirm that the kernel emits a response back to the chat once a model is configured. If the model is not configured, verify that the adapter continues to run and does not crash on inbound messages.

## Idempotence and Recovery

The changes are additive and can be re run safely. Session persistence writes are atomic, and corrupt session files are moved aside with a timestamp suffix so the adapter can recover cleanly. The adapter uses reconnect backoff and should tolerate kernel restarts without manual intervention.

## Artifacts and Notes

Example of the session store file format:

    {
      "version": 1,
      "sessions": {
        "123456789": "session:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
      }
    }

Example commands to run:

    pnpm --filter @bbot/omnicore dev:supervisor
    pnpm --filter @bbot/bot-telegram dev

## Interfaces and Dependencies

AdapterClient lives at packages/omnicore/src/adapters/client.ts and exposes connect, disconnect, send, and sendEvent. It accepts options including adapterId, url, and onAction callbacks. The Telegram app imports AdapterClient, createEvent, createTraceId, and resolveOmnicoreDataDir from the @bbot/omnicore package. The app uses the shared loadEnv function from @bbot/shared and the zod package to validate BOT_TOKEN and optional settings. No third party Telegram library is used; all Telegram traffic uses the built in fetch and the Bot API endpoints getUpdates, sendMessage, and sendChatAction.

Change log: 2026-02-15, initial plan created and implementation recorded.
