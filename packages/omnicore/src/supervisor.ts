import { spawn, type ChildProcess } from "child_process";
import path from "path";

import { JsonlEventLog } from "./event-log";
import type { Event } from "./events";
import type { SupervisorConfig } from "./config";

const getActionType = (event: Event): string | null => {
  if (event.type !== "action.requested") {
    return null;
  }
  const payload = event.payload as { action?: { type?: string } };
  return payload.action?.type ?? null;
};

export const runSupervisor = async (config: SupervisorConfig): Promise<void> => {
  const eventLog = new JsonlEventLog(path.join(config.dataDir, "events.log"));
  let child: ChildProcess | null = null;
  let restarting = false;
  let lastRestartEventId: string | null = null;

  const spawnKernel = () => {
    const current = spawn(config.kernelCommand, config.kernelArgs, {
      cwd: config.kernelCwd,
      env: process.env,
      stdio: "inherit",
    });
    child = current;

    current.on("exit", (code, signal) => {
      if (restarting) {
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

  await eventLog.tail(async (event) => {
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
};
