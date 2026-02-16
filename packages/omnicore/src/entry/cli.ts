import path from "path";
import { Command } from "commander";
import { confirm, input, password, select } from "@inquirer/prompts";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { createLogger } from "@bbot/shared";

import {
  loadKernelConfig,
  loadSupervisorConfig,
  resolveOmnicoreDataDir,
} from "../runtime/config";
import { ConfigStore } from "../infra/config-store";
import { openDb } from "../infra/db";
import { SqliteEventStore } from "../infra/event-store";
import { SYSTEM_SESSION_ID, createEvent, createTraceId } from "../domain/events";
import { SessionStore, type SessionStatus } from "../infra/session-store";
import { runMigrations } from "../infra/migrations";
import { startKernel } from "../runtime/kernel";
import { runSupervisor } from "./supervisor";
import { runCliAdapter } from "./cli-adapter";
import {
  installService,
  loadDefaultLogsDir,
  loadDefaultWorkspaceRoot,
  restartService,
  serviceLogs,
  serviceStatus,
  startService,
  stopService,
  uninstallService,
  updateService,
} from "../runtime/service";
import {
  requestSupervisorRestart,
  requestSupervisorStatus,
} from "../runtime/supervisor-control";

if (!process.env.OMNICORE_ROOT && !process.env.OMNICORE_DATA_DIR) {
  process.env.OMNICORE_ROOT = loadDefaultWorkspaceRoot();
}

const logger = createLogger({ name: "omnicore.cli" });

const logInfo = (message: string) => {
  console.log(message);
  logger.info(message);
};

const logError = (message: string) => {
  console.error(message);
  logger.error(message);
};

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

const syncSessionProjection = (db: ReturnType<typeof openDb>): number => {
  const eventStore = new SqliteEventStore(db);
  const sessionStore = new SessionStore(db);
  let cursor = sessionStore.loadCursor();
  const pending = eventStore.readSince(cursor);
  for (const row of pending) {
    sessionStore.applyEvent(row.event, row.seq);
    cursor = row.seq;
  }
  sessionStore.saveCursor(cursor);
  return cursor;
};

const handleStatus = async () => {
  try {
    const { socketPath, status } = await requestSupervisorStatus();
    const kernelLine = status.kernelRunning
      ? `[omnicore] kernel: running (pid ${status.kernelPid})`
      : "[omnicore] kernel: stopped";
    logInfo(`[omnicore] supervisor: running (pid ${status.supervisorPid})`);
    logInfo(kernelLine);
    logInfo(`[omnicore] uptime: ${status.supervisorUptimeSec}s`);
    logInfo(`[omnicore] restarts: ${status.restarts}`);
    if (status.lastKernelExitAt) {
      const detail = status.lastKernelExitCode !== null
        ? `code ${status.lastKernelExitCode}`
        : status.lastKernelExitSignal
          ? `signal ${status.lastKernelExitSignal}`
          : "unknown";
      logInfo(`[omnicore] last kernel exit: ${status.lastKernelExitAt} (${detail})`);
    }
    logInfo(`[omnicore] control socket: ${socketPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(`[omnicore] status failed: ${message}`);
    process.exitCode = 1;
  }
};

const handleRestart = async () => {
  try {
    const message = await requestSupervisorRestart();
    logInfo(`[omnicore] ${message}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(`[omnicore] restart failed: ${message}`);
    process.exitCode = 1;
  }
};

const handleListSessions = async (options: { status?: SessionStatus; limit?: number }) => {
  await withDb(async (db) => {
    const store = new SessionStore(db);
    const sessions = store.listSessions({
      status: options.status,
      limit: options.limit,
    });

    if (sessions.length === 0) {
      logInfo("[omnicore] no sessions found");
      return;
    }

    for (const session of sessions) {
      const title = session.title ? ` ${session.title}` : "";
      const root = session.rootPath ? ` root=${session.rootPath}` : "";
      logInfo(
        `[omnicore] ${session.id} (${session.status}) updated=${session.updatedAt}${root}${title}`
      );
    }
  });
};

const handleArchiveSession = async (sessionId: string) => {
  if (!sessionId.trim()) {
    logInfo("Usage: omnicore session-archive <sessionId>");
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
    syncSessionProjection(db);
    logInfo(`[omnicore] session archived (${sessionId})`);
  });
};

const handleRenameSession = async (sessionId: string, title: string) => {
  if (!sessionId.trim() || !title.trim()) {
    logInfo("Usage: omnicore session-rename <sessionId> <title>");
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
    syncSessionProjection(db);
    logInfo(`[omnicore] session renamed (${sessionId})`);
  });
};

const handleSessionRoot = async (sessionId: string, rootPath: string) => {
  if (!sessionId.trim() || !rootPath.trim()) {
    logInfo("Usage: omnicore session-root <sessionId> <path>");
    return;
  }
  await withDb(async (db) => {
    const sessionStore = new SessionStore(db);
    const existing = sessionStore.getSession(sessionId);
    if (existing?.firstLlmSeq) {
      logInfo("[omnicore] session root is locked (LLM already started)");
      return;
    }
    const absoluteRoot = path.isAbsolute(rootPath)
      ? rootPath
      : path.resolve(process.cwd(), rootPath);
    const eventStore = new SqliteEventStore(db);
    const event = createEvent({
      type: "session.root.set",
      actorId: null,
      traceId: createTraceId(),
      sessionId,
      payload: { rootPath: absoluteRoot },
    });
    eventStore.append(event);
    syncSessionProjection(db);
    logInfo(`[omnicore] session root updated (${sessionId})`);
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
    logInfo(`[omnicore] sessions projection rebuilt (${cursor} events)`);
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

    logInfo("[omnicore] config updated");
  });
};

const program = new Command();

program
  .name("bbot")
  .description("BBot kernel CLI")
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
  .command("agent")
  .description("Start the CLI adapter (interactive chat)")
  .action(() => {
    runCliAdapter();
  });

const serviceCmd = program
  .command("service")
  .description("Manage background service");

interface ResolvedServiceInstall {
  label: string;
  root: string;
  port: number;
  dataDir: string;
  dbPath?: string;
  logsDir?: string;
  bin?: string;
  logs: boolean;
  start: boolean;
}

interface ServiceInstallCommandOptions {
  label: string;
  root?: string;
  port?: string;
  dataDir?: string;
  dbPath?: string;
  logsDir?: string;
  bin?: string;
  logs?: boolean;
  start: boolean;
  nonInteractive?: boolean;
}

const resolveServiceInstallOptions = async (
  options: ServiceInstallCommandOptions
): Promise<ResolvedServiceInstall> => {
  const defaultRoot = options.root ?? loadDefaultWorkspaceRoot();
  const defaults: ResolvedServiceInstall = {
    label: options.label,
    root: defaultRoot,
    port: Number(options.port ?? loadKernelConfig().adapterPort),
    dataDir: options.dataDir ?? resolveOmnicoreDataDir(defaultRoot),
    dbPath: options.dbPath,
    logsDir: options.logsDir ?? loadDefaultLogsDir(),
    bin: options.bin,
    logs: options.logs !== false,
    start: options.start,
  };

  let resolved: ResolvedServiceInstall = { ...defaults };
  if (!options.nonInteractive && process.stdin.isTTY) {
    const useDefaults = await confirm({
      message: "Use default service settings?",
      default: true,
    });

    if (!useDefaults) {
      const label = (await input({
        message: "Service label",
        default: resolved.label,
      })).trim();
      const root = (await input({
        message: "Workspace root",
        default: resolved.root,
      })).trim();
      const portRaw = (await input({
        message: "Adapter port",
        default: String(resolved.port),
      })).trim();
      const dataDir = (await input({
        message: "Data directory",
        default: resolved.dataDir,
      })).trim();
      const dbPath = (await input({
        message: "Database path (optional)",
        default: resolved.dbPath ?? "",
      })).trim();
      const logsDir = (await input({
        message: "Log directory (blank = disable)",
        default: resolved.logsDir ?? "",
      })).trim();
      const binPath = (await input({
        message: "bbot binary path (optional)",
        default: resolved.bin ?? "",
      })).trim();
      const start = await confirm({
        message: "Start service now?",
        default: resolved.start,
      });

      const parsedPort = Number(portRaw);
      if (!Number.isFinite(parsedPort) || parsedPort <= 0) {
        throw new Error("Invalid adapter port");
      }

      resolved = {
        label: label || resolved.label,
        root: root || resolved.root,
        port: parsedPort,
        dataDir: dataDir || resolved.dataDir,
        dbPath: dbPath || undefined,
        logsDir: logsDir || undefined,
        bin: binPath || undefined,
        logs: logsDir !== "",
        start,
      };
    }
  }

  return resolved;
};

serviceCmd
  .command("install")
  .description("Install supervisor as a user service")
  .option("--label <label>", "service label", "ai.bbot.omnicore")
  .option("--root <path>", "workspace root")
  .option("--port <port>", "adapter port")
  .option("--data-dir <path>", "data directory")
  .option("--db-path <path>", "database path")
  .option("--logs-dir <path>", "log directory")
  .option("--bin <path>", "bbot binary path")
  .option("--no-logs", "disable log file redirection")
  .option("--no-start", "do not start after install")
  .option("--non-interactive", "do not prompt for input")
  .action(async (options: ServiceInstallCommandOptions) => {
    const resolved = await resolveServiceInstallOptions(options);
    const port = Number(resolved.port);
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error("Invalid --port value");
    }
    await installService({
      label: resolved.label,
      root: resolved.root,
      adapterPort: port,
      dataDir: resolved.dataDir,
      dbPath: resolved.dbPath,
      logsDir: resolved.logs ? resolved.logsDir ?? loadDefaultLogsDir() : null,
      bbotBin: resolved.bin,
      start: resolved.start,
    });
    logInfo("[bbot] service installed");
  });

serviceCmd
  .command("update")
  .description("Update service configuration and restart")
  .option("--label <label>", "service label", "ai.bbot.omnicore")
  .option("--root <path>", "workspace root")
  .option("--port <port>", "adapter port")
  .option("--data-dir <path>", "data directory")
  .option("--db-path <path>", "database path")
  .option("--logs-dir <path>", "log directory")
  .option("--bin <path>", "bbot binary path")
  .option("--no-logs", "disable log file redirection")
  .option("--no-start", "do not start after update")
  .option("--non-interactive", "do not prompt for input")
  .action(async (options: ServiceInstallCommandOptions) => {
    const resolved = await resolveServiceInstallOptions(options);
    const port = Number(resolved.port);
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error("Invalid --port value");
    }
    await updateService({
      label: resolved.label,
      root: resolved.root,
      adapterPort: port,
      dataDir: resolved.dataDir,
      dbPath: resolved.dbPath,
      logsDir: resolved.logs ? resolved.logsDir ?? loadDefaultLogsDir() : null,
      bbotBin: resolved.bin,
      start: resolved.start,
    });
    logInfo("[bbot] service updated");
  });

serviceCmd
  .command("status")
  .description("Show service status")
  .option("--label <label>", "service label", "ai.bbot.omnicore")
  .action((options: { label: string }) => {
    serviceStatus({ label: options.label });
  });

serviceCmd
  .command("start")
  .description("Start the service")
  .option("--label <label>", "service label", "ai.bbot.omnicore")
  .action((options: { label: string }) => {
    startService({ label: options.label });
  });

serviceCmd
  .command("stop")
  .description("Stop the service")
  .option("--label <label>", "service label", "ai.bbot.omnicore")
  .action((options: { label: string }) => {
    stopService({ label: options.label });
  });

serviceCmd
  .command("restart")
  .description("Restart the service")
  .option("--label <label>", "service label", "ai.bbot.omnicore")
  .action((options: { label: string }) => {
    restartService({ label: options.label });
  });

serviceCmd
  .command("logs")
  .description("Tail service logs")
  .option("--logs-dir <path>", "log directory")
  .option("--lines <lines>", "lines to show", "200")
  .option("--no-follow", "do not follow")
  .action((options: { logsDir?: string; lines: string; follow: boolean }) => {
    const lines = Number(options.lines);
    if (!Number.isFinite(lines) || lines <= 0) {
      throw new Error("Invalid --lines value");
    }
    serviceLogs({
      logsDir: options.logsDir,
      lines,
      follow: options.follow,
    });
  });

serviceCmd
  .command("uninstall")
  .description("Remove the service")
  .option("--label <label>", "service label", "ai.bbot.omnicore")
  .action(async (options: { label: string }) => {
    await uninstallService({ label: options.label });
    logInfo("[bbot] service uninstalled");
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
  .command("session-root")
  .description("Set session root path (only before first LLM call)")
  .argument("<sessionId>", "session id to update")
  .argument("<path>", "root path")
  .action(async (sessionId: string, rootPath: string) => {
    await handleSessionRoot(sessionId, rootPath);
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
    logInfo("[omnicore] model updated");
  });

configCmd
  .command("set-base-url")
  .description("Set model base URL")
  .argument("<url>")
  .action(async (baseUrl: string) => {
    await withConfigStore(async (store) => {
      store.setKernelSettings({ modelBaseUrl: baseUrl });
    });
    logInfo("[omnicore] base url updated");
  });

configCmd
  .command("set-thinking")
  .description("Set thinking level")
  .argument("<level>")
  .action(async (level: string) => {
    if (!THINKING_LEVELS.includes(level as ThinkingLevel)) {
      logInfo("Usage: omnicore config set-thinking <off|minimal|low|medium|high|xhigh>");
      return;
    }
    await withConfigStore(async (store) => {
      store.setKernelSettings({ thinkingLevel: level as ThinkingLevel });
    });
    logInfo("[omnicore] thinking level updated");
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
    logInfo("[omnicore] compaction enabled updated");
  });

configCmd
  .command("set-compaction-reserve")
  .description("Set compaction reserve tokens")
  .argument("<tokens>")
  .action(async (tokens: string) => {
    const value = Number(tokens);
    if (!Number.isFinite(value) || value <= 0) {
      logInfo("Usage: omnicore config set-compaction-reserve <tokens>");
      return;
    }
    await withConfigStore(async (store) => {
      store.setKernelSettings({ compactionReserveTokens: value });
    });
    logInfo("[omnicore] compaction reserve tokens updated");
  });

configCmd
  .command("set-compaction-keep")
  .description("Set compaction keep-recent tokens")
  .argument("<tokens>")
  .action(async (tokens: string) => {
    const value = Number(tokens);
    if (!Number.isFinite(value) || value < 0) {
      logInfo("Usage: omnicore config set-compaction-keep <tokens>");
      return;
    }
    await withConfigStore(async (store) => {
      store.setKernelSettings({ compactionKeepRecentTokens: value });
    });
    logInfo("[omnicore] compaction keep-recent tokens updated");
  });

configCmd
  .command("set-auto-compact")
  .description("Set auto-compact token limit (or 'off')")
  .argument("<limit>")
  .action(async (limit: string) => {
    const normalized = limit.trim().toLowerCase();
    const value = normalized === "off" ? undefined : Number(normalized);
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
      logInfo("Usage: omnicore config set-auto-compact <number|off>");
      return;
    }
    await withConfigStore(async (store) => {
      store.setKernelSettings({ compactionAutoCompactTokenLimit: value });
    });
    logInfo("[omnicore] auto-compact token limit updated");
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
      logInfo("Usage: omnicore config set-secret <key> <value> [--prompt]");
      return;
    }
    await withConfigStore(async (store) => {
      store.setSecret(key, secret as string);
    });
    logInfo("[omnicore] secret updated");
  });

configCmd
  .command("show")
  .description("Show current kernel config")
  .action(async () => {
    await withConfigStore(async (store) => {
      const settings = store.getKernelSettings();
      logInfo(JSON.stringify(settings, null, 2));
    });
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logError(`[omnicore] ${message}`);
  process.exitCode = 1;
});
