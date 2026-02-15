# OmniCore (v1)

OmniCore is a minimal, AI‑native kernel. It does not know Telegram/Discord. Channels are external adapters that connect over WebSocket and send/receive events.

## What You Get

- Channel‑agnostic kernel with event sourcing (SQLite)
- Hot‑plug adapters over WebSocket (any language)
- Heartbeat trait inside the kernel
- Supervisor that restarts kernel when the agent requests it

## Concepts in One Minute

- **Kernel**: the brain. It only knows events and actions.
- **Adapter**: a channel plugin. It converts inbound messages to events and receives outbound actions.
- **Event Log**: SQLite table of everything that happened.
- **Session**: a chat thread boundary. Events are grouped by `sessionId`.
- **AGENTS.md**: the kernel instructions. This is the “mission”.

## Quick Start (Local Dev)

### 1) Start the supervisor

```bash
pnpm --filter @bbot/omnicore dev:supervisor
```

This starts the supervisor, which spawns the kernel and restarts it when needed.
Keep it running, and use a second terminal for commands like `status` or `restart`.

### 2) Start a local CLI adapter

```bash
pnpm --filter @bbot/omnicore dev:adapter
```

Type in this terminal. The adapter sends your text as events. Replies are printed back.
OmniCore only responds when an LLM model is configured.

CLI adapter session commands:

- `/session` show current session id
- `/new` start a new session (fresh context)
- `/use <sessionId>` switch to an existing session

If the model supports reasoning and `thinking` is enabled, the CLI will show
`thinking...` / `thinking done` status lines while the agent is working.

## Telegram Adapter (Bot API)

The Telegram adapter runs as a separate app and connects to the kernel over WebSocket.

1) Start the supervisor and kernel as shown above.

2) Create apps/bot-telegram/.env with the required values:

    BOT_TOKEN=your-telegram-bot-token
    OMNICORE_ADAPTER_URL=ws://localhost:8787
    OMNICORE_ADAPTER_ID=telegram
    BOT_TELEGRAM_ALLOWED_USER_IDS=12345,67890

3) Start the adapter:

    pnpm --filter @bbot/bot-telegram dev

Commands include /start, /help, /session, /new, and /use with a session id.

Session mapping is stored in .omnicore/telegram-sessions.json.

### 3) Configure model + BaseURL + key (SQLite)

Interactive:

```bash
pnpm --filter @bbot/omnicore dev:config
```

Or direct commands:

```bash
pnpm --filter @bbot/omnicore dev:config -- set-model openai gpt-4o-mini
pnpm --filter @bbot/omnicore dev:config -- set-base-url https://api.openai.com/v1
pnpm --filter @bbot/omnicore dev:config -- set-thinking medium
pnpm --filter @bbot/omnicore dev:config -- set-secret llm.apiKey <your-key>
```

Compaction (optional):

```bash
pnpm --filter @bbot/omnicore dev:config -- set-compaction-enabled true
pnpm --filter @bbot/omnicore dev:config -- set-compaction-reserve 16384
pnpm --filter @bbot/omnicore dev:config -- set-compaction-keep 20000
pnpm --filter @bbot/omnicore dev:config -- set-auto-compact 120000
```

Restart if needed:

```bash
pnpm --filter @bbot/omnicore exec tsx src/cli.ts restart
```

## Sessions (Chat Threads)

OmniCore models a chat thread as a **session**. Every event must carry a `sessionId`.
Adapters decide when to create a new session (like the “New Chat” button).
Each session can have its own root path; the kernel reads `AGENTS.md` from that path.

For the CLI adapter:

- By default it creates a fresh session on startup.
- Set `OMNICORE_SESSION_ID` to continue an existing session.
- Use `/new` to reset context.
- Use `session-root` before the first LLM call to set the session root path.

## Supervisor Commands

```bash
pnpm --filter @bbot/omnicore exec tsx src/cli.ts status
pnpm --filter @bbot/omnicore exec tsx src/cli.ts restart
pnpm --filter @bbot/omnicore exec tsx src/cli.ts sessions
pnpm --filter @bbot/omnicore exec tsx src/cli.ts sessions --status archived
pnpm --filter @bbot/omnicore exec tsx src/cli.ts session-archive <sessionId>
pnpm --filter @bbot/omnicore exec tsx src/cli.ts session-rename <sessionId> <title>
pnpm --filter @bbot/omnicore exec tsx src/cli.ts session-root <sessionId> <path>
pnpm --filter @bbot/omnicore exec tsx src/cli.ts sessions-rebuild
```

## Adapter Protocol (JSON over WebSocket)

Connect to `ws://localhost:8787` by default.

### Adapter → Kernel

```json
{"type":"hello","adapterId":"cli","capabilities":["send_message","event_in"]}
```

```json
{"type":"event","event":{"type":"signal.inbound","actorId":"cli:local","traceId":"...","sessionId":"session:abc","payload":{"kind":"message","text":"hi"}}}
```

### Kernel → Adapter

```json
{"type":"action","action":{"type":"send_message","actorId":"cli:local","text":"hello"},"traceId":"...","sessionId":"session:abc"}
```

Routing rule: `actorId` is prefixed with `adapterId`, for example `discord:12345` or `cli:local`.

## Files You Should Know

- `AGENTS.md`: kernel instructions and policies
- `heartbeat.md`: per-person heartbeat intentions (human-authored)
- `.omnicore/omnicore.db`: SQLite event log and config

## Environment Variables (only for locating runtime)

- `OMNICORE_ROOT` default is `INIT_CWD` or `process.cwd()`
- `OMNICORE_DATA_DIR` overrides data dir
- `OMNICORE_DB_PATH` overrides SQLite path
- `OMNICORE_SANDBOX_ROOT` overrides sandbox root
- `OMNICORE_ADAPTER_PORT` defaults to `8787`
- `OMNICORE_KERNEL_CMD` supervisor spawn command
- `OMNICORE_KERNEL_ARGS` supervisor args
- `OMNICORE_KERNEL_CWD` supervisor cwd

## Notes

- Model provider, base URL, thinking level, and API key live in SQLite.
- Memory is file‑based (AGENTS.md + MEMORY.md), not in SQLite.
