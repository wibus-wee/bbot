import { Command } from "commander";
import { confirm, input, password, select } from "@inquirer/prompts";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";

import { loadKernelConfig, loadSupervisorConfig } from "./config";
import { ConfigStore } from "./config-store";
import { openDb } from "./db";
import { SqliteEventStore } from "./event-store";
import { createEvent, createTraceId } from "./events";
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
      payload: {
        action: { type: "restart", reason: "cli" },
      },
    });
    eventStore.append(event);
    console.log(`[omnicore] restart requested (${event.id})`);
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
