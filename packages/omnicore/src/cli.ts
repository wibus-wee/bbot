import { loadKernelConfig, loadSupervisorConfig } from "./config";
import { ConfigStore } from "./config-store";
import { openDb } from "./db";
import { SqliteEventStore } from "./event-store";
import { createEvent, createTraceId } from "./events";
import { runMigrations } from "./migrations";
import { startKernel } from "./kernel";
import { runSupervisor } from "./supervisor";

const command = process.argv[2];

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

const handleConfig = async () => {
  const sub = process.argv[3];
  switch (sub) {
    case "set-model": {
      const provider = process.argv[4];
      const model = process.argv[5];
      if (!provider || !model) {
        console.log("Usage: omnicore config set-model <provider> <model>");
        return;
      }
      await withConfigStore(async (store) => {
        store.setKernelSettings({ modelProvider: provider, modelName: model });
      });
      console.log("[omnicore] model updated");
      return;
    }
    case "set-secret": {
      const key = process.argv[4];
      const value = process.argv[5];
      if (!key || !value) {
        console.log("Usage: omnicore config set-secret <key> <value>");
        return;
      }
      await withConfigStore(async (store) => {
        store.setSecret(key, value);
      });
      console.log("[omnicore] secret updated");
      return;
    }
    case "show": {
      await withConfigStore(async (store) => {
        const settings = store.getKernelSettings();
        console.log(JSON.stringify(settings, null, 2));
      });
      return;
    }
    default:
      console.log("Usage: omnicore config <set-model|set-secret|show>");
  }
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

const main = async () => {
  switch (command) {
    case "kernel":
      await startKernel(loadKernelConfig());
      return;
    case "supervisor":
      await runSupervisor(loadSupervisorConfig());
      return;
    case "config":
      await handleConfig();
      return;
    case "status":
      await handleStatus();
      return;
    case "restart":
      await handleRestart();
      return;
    default:
      console.log("Usage: omnicore <kernel|supervisor|status|restart|config>");
  }
};

void main();
