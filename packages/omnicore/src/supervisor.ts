import { spawn, type ChildProcess } from "child_process";

import type { SupervisorConfig } from "./config";
import { openDb } from "./db";
import { SqliteEventStore } from "./event-store";
import type { Event } from "./events";
import { runMigrations } from "./migrations";

const getActionType = (event: Event): string | null => {
  if (event.type !== "action.requested") {
    return null;
  }
  const payload = event.payload as { action?: { type?: string } };
  return payload.action?.type ?? null;
};

export const runSupervisor = async (config: SupervisorConfig): Promise<void> => {
  const db = openDb({ path: config.dbPath });
  await runMigrations(db);

  const eventStore = new SqliteEventStore(db);
  let child: ChildProcess | null = null;
  let restarting = false;
  let lastRestartEventId: string | null = null;
  let stopping = false;

  const spawnKernel = () => {
    const current = spawn(config.kernelCommand, config.kernelArgs, {
      cwd: config.kernelCwd,
      env: process.env,
      stdio: "inherit",
    });
    child = current;

    current.on("exit", (code, signal) => {
      if (restarting || stopping) {
        return;
      }
      console.log(`[omnicore] kernel exited (${signal ?? code ?? "unknown"}), restarting`);
      void scheduleRestart();
    });
  };

  const scheduleRestart = async () => {
    if (restarting) {
      return;
    }
    restarting = true;

    if (child) {
      child.kill("SIGTERM");
      child = null;
    }

    await new Promise((resolve) => setTimeout(resolve, config.restartDebounceMs));
    spawnKernel();
    restarting = false;
  };

  spawnKernel();

  const stopTail = eventStore.tail(async (event) => {
    const actionType = getActionType(event);
    if (actionType !== "restart") {
      return;
    }
    if (event.id === lastRestartEventId) {
      return;
    }
    lastRestartEventId = event.id;
    console.log("[omnicore] restart requested by event", event.id);
    await scheduleRestart();
  }, { fromEnd: true });

  const shutdown = async () => {
    if (stopping) {
      return;
    }
    stopping = true;
    stopTail();
    if (child) {
      child.kill("SIGTERM");
      child = null;
    }
  };

  const waitForExit = new Promise<void>((resolve) => {
    const handle = () => {
      void shutdown().finally(resolve);
    };
    process.on("SIGINT", handle);
    process.on("SIGTERM", handle);
  });

  console.log(`[omnicore] supervisor started (db: ${config.dbPath})`);
  await waitForExit;
};
