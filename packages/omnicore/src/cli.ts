import { Command } from "commander";
import { confirm, input, password, select } from "@inquirer/prompts";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";

import { loadKernelConfig, loadSupervisorConfig } from "./config";
import { ConfigStore } from "./config-store";
import { openDb } from "./db";
import { SqliteEventStore } from "./event-store";
import { SYSTEM_SESSION_ID, createEvent, createTraceId } from "./events";
import { SessionStore, type SessionStatus } from "./session-store";
import { runMigrations } from "./migrations";
import { startKernel } from "./kernel";
import { runSupervisor } from "./supervisor";

const THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

const ensureTty = () => {
  if (!process.stdin.isTTY) {
    throw new Error("Interactive mode requires a TTY.");
  }
};

const withDb = async <T>(fn: (db: ReturnType<typeof openDb>) => Promise<T>): Promise<T> => {
  const config = loadKernelConfig();
  const db = openDb({ path: config.dbPath });
  await runMigrations(db);
  return fn(db);
};

const withConfigStore = async <T>(fn: (store: ConfigStore) => Promise<T>): Promise<T> => {
  return withDb(async (db) => {
    const store = new ConfigStore(db);
    return fn(store);
  });
};

const handleStatus = async () => {
  await withDb(async (db) => {
    const config = loadKernelConfig();
    const eventStore = new SqliteEventStore(db);
    const latestSeq = eventStore.getLatestSeq();
    const recent = eventStore.readRecent(200);
    const lastEvent = recent.length > 0 ? recent[recent.length - 1] : null;
    const lastHeartbeat =
      [...recent]
        .reverse()
        .find(
          (event) =>
            event.type === "signal.internal" &&
            (event.payload as { kind?: string }).kind === "heartbeat"
        ) ?? null;

    const now = Date.now();
    const heartbeatAgeSec = lastHeartbeat
      ? Math.round((now - new Date(lastHeartbeat.timestamp).getTime()) / 1000)
      : null;

    console.log(`[omnicore] db: ${config.dbPath}`);
    console.log(`[omnicore] events: ${latestSeq}`);
    if (lastEvent) {
      console.log(`[omnicore] last event: ${lastEvent.type} @ ${lastEvent.timestamp}`);
    } else {
      console.log("[omnicore] last event: none");
    }
    if (lastHeartbeat) {
      console.log(
        `[omnicore] last heartbeat: ${lastHeartbeat.timestamp} (${heartbeatAgeSec}s ago)`
      );
    } else {
      console.log("[omnicore] last heartbeat: none");
    }
  });
};

const handleRestart = async () => {
  await withDb(async (db) => {
    const eventStore = new SqliteEventStore(db);
    const event = createEvent({
      type: "action.requested",
      actorId: null,
      traceId: createTraceId(),
      sessionId: SYSTEM_SESSION_ID,
      payload: {
        action: { type: "restart", reason: "cli" },
      },
    });
    eventStore.append(event);
    console.log(`[omnicore] restart requested (${event.id})`);
  });
};

const handleListSessions = async (options: { status?: SessionStatus; limit?: number }) => {
  await withDb(async (db) => {
    const store = new SessionStore(db);
    const sessions = store.listSessions({
      status: options.status,
      limit: options.limit,
    });

    if (sessions.length === 0) {
      console.log("[omnicore] no sessions found");
      return;
    }

    for (const session of sessions) {
      const title = session.title ? ` ${session.title}` : "";
      console.log(
        `[omnicore] ${session.id} (${session.status}) updated=${session.updatedAt}${title}`
      );
    }
  });
};

const handleArchiveSession = async (sessionId: string) => {
  if (!sessionId.trim()) {
    console.log("Usage: omnicore session-archive <sessionId>");
    return;
  }
  await withDb(async (db) => {
    const eventStore = new SqliteEventStore(db);
    const event = createEvent({
      type: "session.archived",
      actorId: null,
      traceId: createTraceId(),
      sessionId,
      payload: {},
    });
    eventStore.append(event);
    console.log(`[omnicore] session archived (${sessionId})`);
  });
};

const handleRenameSession = async (sessionId: string, title: string) => {
  if (!sessionId.trim() || !title.trim()) {
    console.log("Usage: omnicore session-rename <sessionId> <title>");
    return;
  }
  await withDb(async (db) => {
    const eventStore = new SqliteEventStore(db);
    const event = createEvent({
      type: "session.renamed",
      actorId: null,
      traceId: createTraceId(),
      sessionId,
      payload: { title },
    });
    eventStore.append(event);
    console.log(`[omnicore] session renamed (${sessionId})`);
  });
};

const handleRebuildSessions = async () => {
  await withDb(async (db) => {
    const eventStore = new SqliteEventStore(db);
    const sessionStore = new SessionStore(db);
    sessionStore.resetProjection();

    const events = eventStore.readSince(0);
    let cursor = 0;
    for (const row of events) {
      sessionStore.applyEvent(row.event, row.seq);
      cursor = row.seq;
    }
    sessionStore.saveCursor(cursor);
    console.log(`[omnicore] sessions projection rebuilt (${cursor} events)`);
  });
};

const runConfigWizard = async () => {
  ensureTty();
  await withConfigStore(async (store) => {
    const current = store.getKernelSettings();
    const currentKey = store.getSecret("llm.apiKey");

    const provider = (await input({
      message: "Provider",
      default: current.modelProvider ?? "openai",
    })).trim();

    const model = (await input({
      message: "Model",
      default: current.modelName ?? "gpt-4o-mini",
    })).trim();

    const baseUrlDefault = current.modelBaseUrl
      ?? (provider === "openai" ? "https://api.openai.com/v1" : "");

    const baseUrl = (await input({
      message: "Base URL (optional)",
      default: baseUrlDefault,
    })).trim();

    const thinkingLevel = await select({
      message: "Thinking level",
      choices: THINKING_LEVELS.map((level) => ({ name: level, value: level })),
      default: current.thinkingLevel ?? "medium",
    });

    store.setKernelSettings({
      modelProvider: provider || current.modelProvider,
      modelName: model || current.modelName,
      modelBaseUrl: baseUrl || current.modelBaseUrl,
      thinkingLevel,
    });

    const configureCompaction = await confirm({
      message: "Configure compaction now?",
      default: false,
    });

    if (configureCompaction) {
      const enabled = await confirm({
        message: "Enable compaction?",
        default: current.compactionEnabled,
      });
      const reserveTokens = Number(
        (await input({
          message: "Compaction reserve tokens",
          default: String(current.compactionReserveTokens),
        })).trim()
      );
      const keepRecentTokens = Number(
        (await input({
          message: "Keep recent tokens",
          default: String(current.compactionKeepRecentTokens),
        })).trim()
      );
      const autoCompactRaw = (await input({
        message: "Auto-compact token limit (blank = auto)",
        default: current.compactionAutoCompactTokenLimit
          ? String(current.compactionAutoCompactTokenLimit)
          : "",
      })).trim();
      const autoCompactTokenLimit = autoCompactRaw
        ? Number(autoCompactRaw)
        : undefined;

      store.setKernelSettings({
        compactionEnabled: enabled,
        compactionReserveTokens: Number.isFinite(reserveTokens)
          ? reserveTokens
          : current.compactionReserveTokens,
        compactionKeepRecentTokens: Number.isFinite(keepRecentTokens)
          ? keepRecentTokens
          : current.compactionKeepRecentTokens,
        compactionAutoCompactTokenLimit: Number.isFinite(autoCompactTokenLimit ?? NaN)
          ? autoCompactTokenLimit
          : undefined,
      });
    }

    const shouldSetKey = await confirm({
      message: "Set API key now?",
      default: !currentKey,
    });

    if (shouldSetKey) {
      const apiKey = (await password({
        message: "API key",
        mask: true,
      })).trim();
      if (apiKey) {
        store.setSecret("llm.apiKey", apiKey);
      }
    }

    console.log("[omnicore] config updated");
  });
};

const program = new Command();

program
  .name("omnicore")
  .description("OmniCore kernel CLI")
  .showHelpAfterError(true)
  .showSuggestionAfterError(true);

program
  .command("kernel")
  .description("Start the kernel")
  .action(async () => {
    await startKernel(loadKernelConfig());
  });

program
  .command("supervisor")
  .description("Start the supervisor (spawns kernel)")
  .action(async () => {
    await runSupervisor(loadSupervisorConfig());
  });

program
  .command("sessions")
  .description("List sessions (default: active)")
  .option("--status <status>", "active | archived | all", "active")
  .option("--limit <limit>", "max sessions", "50")
  .action(async (options: { status: string; limit: string }) => {
    const statusRaw = options.status?.trim().toLowerCase();
    const status =
      statusRaw === "all"
        ? undefined
        : statusRaw === "archived"
          ? "archived"
          : "active";
    const limit = Number(options.limit);
    await handleListSessions({
      status: status as SessionStatus | undefined,
      limit: Number.isFinite(limit) ? limit : 50,
    });
  });

program
  .command("session-archive")
  .description("Archive a session by id")
  .argument("<sessionId>", "session id to archive")
  .action(async (sessionId: string) => {
    await handleArchiveSession(sessionId);
  });

program
  .command("session-rename")
  .description("Rename a session by id")
  .argument("<sessionId>", "session id to rename")
  .argument("<title>", "new title")
  .action(async (sessionId: string, title: string) => {
    await handleRenameSession(sessionId, title);
  });

program
  .command("sessions-rebuild")
  .description("Rebuild sessions projection from event log")
  .action(async () => {
    await handleRebuildSessions();
  });

program
  .command("status")
  .description("Show kernel status from event log")
  .action(handleStatus);

program
  .command("restart")
  .description("Request a kernel restart via event")
  .action(handleRestart);

const configCmd = program
  .command("config")
  .description("Manage kernel config (SQLite)")
  .action(async () => {
    if (!process.stdin.isTTY) {
      configCmd.help({ error: true });
      return;
    }
    await runConfigWizard();
  });

configCmd
  .command("wizard")
  .description("Interactive config wizard")
  .action(runConfigWizard);

configCmd
  .command("set-model")
  .description("Set provider and model")
  .argument("<provider>")
  .argument("<model>")
  .action(async (provider: string, model: string) => {
    await withConfigStore(async (store) => {
      store.setKernelSettings({ modelProvider: provider, modelName: model });
    });
    console.log("[omnicore] model updated");
  });

configCmd
  .command("set-base-url")
  .description("Set model base URL")
  .argument("<url>")
  .action(async (baseUrl: string) => {
    await withConfigStore(async (store) => {
      store.setKernelSettings({ modelBaseUrl: baseUrl });
    });
    console.log("[omnicore] base url updated");
  });

configCmd
  .command("set-thinking")
  .description("Set thinking level")
  .argument("<level>")
  .action(async (level: string) => {
    if (!THINKING_LEVELS.includes(level as ThinkingLevel)) {
      console.log("Usage: omnicore config set-thinking <off|minimal|low|medium|high|xhigh>");
      return;
    }
    await withConfigStore(async (store) => {
      store.setKernelSettings({ thinkingLevel: level as ThinkingLevel });
    });
    console.log("[omnicore] thinking level updated");
  });

configCmd
  .command("set-compaction-enabled")
  .description("Enable/disable compaction")
  .argument("<enabled>")
  .action(async (enabled: string) => {
    const normalized = enabled.trim().toLowerCase();
    const value = normalized === "true" || normalized === "1" || normalized === "yes";
    await withConfigStore(async (store) => {
      store.setKernelSettings({ compactionEnabled: value });
    });
    console.log("[omnicore] compaction enabled updated");
  });

configCmd
  .command("set-compaction-reserve")
  .description("Set compaction reserve tokens")
  .argument("<tokens>")
  .action(async (tokens: string) => {
    const value = Number(tokens);
    if (!Number.isFinite(value) || value <= 0) {
      console.log("Usage: omnicore config set-compaction-reserve <tokens>");
      return;
    }
    await withConfigStore(async (store) => {
      store.setKernelSettings({ compactionReserveTokens: value });
    });
    console.log("[omnicore] compaction reserve tokens updated");
  });

configCmd
  .command("set-compaction-keep")
  .description("Set compaction keep-recent tokens")
  .argument("<tokens>")
  .action(async (tokens: string) => {
    const value = Number(tokens);
    if (!Number.isFinite(value) || value < 0) {
      console.log("Usage: omnicore config set-compaction-keep <tokens>");
      return;
    }
    await withConfigStore(async (store) => {
      store.setKernelSettings({ compactionKeepRecentTokens: value });
    });
    console.log("[omnicore] compaction keep-recent tokens updated");
  });

configCmd
  .command("set-auto-compact")
  .description("Set auto-compact token limit (or 'off')")
  .argument("<limit>")
  .action(async (limit: string) => {
    const normalized = limit.trim().toLowerCase();
    const value = normalized === "off" ? undefined : Number(normalized);
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
      console.log("Usage: omnicore config set-auto-compact <number|off>");
      return;
    }
    await withConfigStore(async (store) => {
      store.setKernelSettings({ compactionAutoCompactTokenLimit: value });
    });
    console.log("[omnicore] auto-compact token limit updated");
  });

configCmd
  .command("set-secret")
  .description("Set a secret value in SQLite")
  .argument("<key>")
  .argument("[value]")
  .option("-p, --prompt", "Prompt for secret value")
  .action(async (key: string, value: string | undefined, options: { prompt?: boolean }) => {
    let secret = value;
    if (options.prompt || !secret) {
      ensureTty();
      secret = (await password({ message: `Secret value for ${key}`, mask: true })).trim();
    }
    if (!secret) {
      console.log("Usage: omnicore config set-secret <key> <value> [--prompt]");
      return;
    }
    await withConfigStore(async (store) => {
      store.setSecret(key, secret as string);
    });
    console.log("[omnicore] secret updated");
  });

configCmd
  .command("show")
  .description("Show current kernel config")
  .action(async () => {
    await withConfigStore(async (store) => {
      const settings = store.getKernelSettings();
      console.log(JSON.stringify(settings, null, 2));
    });
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[omnicore] ${message}`);
  process.exitCode = 1;
});
