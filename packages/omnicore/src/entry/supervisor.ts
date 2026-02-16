import { spawn, type ChildProcess } from "child_process";
import http from "http";
import path from "path";
import { existsSync, unlinkSync, chmodSync, mkdirSync } from "fs";

import { createLogger } from "@bbot/shared";

import type { SupervisorConfig } from "../runtime/config";
import { openDb } from "../infra/db";
import { SqliteEventStore } from "../infra/event-store";
import type { Event } from "../domain/events";
import { runMigrations } from "../infra/migrations";

const logger = createLogger({ name: "omnicore.supervisor" });

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
  const supervisorStartedAt = Date.now();
  let kernelStartedAt: number | null = null;
  let lastKernelExitAt: number | null = null;
  let lastKernelExitCode: number | null = null;
  let lastKernelExitSignal: string | null = null;
  let restartCount = 0;

  const controlSocketPath = config.controlSocketPath;
  let controlServer: http.Server | null = null;

  const spawnKernel = () => {
    const current = spawn(config.kernelCommand, config.kernelArgs, {
      cwd: config.kernelCwd,
      env: process.env,
      stdio: "inherit",
    });
    child = current;
    kernelStartedAt = Date.now();

    current.on("exit", (code, signal) => {
      lastKernelExitAt = Date.now();
      lastKernelExitCode = code ?? null;
      lastKernelExitSignal = signal ?? null;
      child = null;
      if (restarting || stopping) {
        return;
      }
      logger.info(
        { signal: signal ?? null, code: code ?? null },
        "[omnicore] kernel exited, restarting",
      );
      void scheduleRestart();
    });

    current.on("error", (error) => {
      lastKernelExitAt = Date.now();
      lastKernelExitCode = null;
      lastKernelExitSignal = null;
      child = null;
      logger.error({ error }, "[omnicore] kernel spawn error");
      void scheduleRestart();
    });
  };

  const waitForChildExit = (proc: ChildProcess, timeoutMs: number): Promise<void> => {
    return new Promise((resolve) => {
      if (proc.exitCode !== null) {
        resolve();
        return;
      }

      let done = false;
      const finish = () => {
        if (done) {
          return;
        }
        done = true;
        resolve();
      };

      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        finish();
      }, timeoutMs);

      proc.once("exit", () => {
        clearTimeout(timer);
        finish();
      });
    });
  };

  const scheduleRestart = async () => {
    if (restarting) {
      return;
    }
    restarting = true;
    restartCount += 1;

    if (child) {
      child.kill("SIGTERM");
      const current = child;
      child = null;
      await waitForChildExit(current, Math.max(config.restartDebounceMs, 3000));
    }

    await new Promise((resolve) => setTimeout(resolve, config.restartDebounceMs));
    spawnKernel();
    restarting = false;
  };

  spawnKernel();

  const startControlServer = () => {
    if (existsSync(controlSocketPath)) {
      unlinkSync(controlSocketPath);
    }
    mkdirSync(path.dirname(controlSocketPath), { recursive: true });

    controlServer = http.createServer(async (req, res) => {
      if (!req.url) {
        res.writeHead(400);
        res.end();
        return;
      }
      if (req.method === "GET" && req.url === "/status") {
        const now = Date.now();
        const payload = {
          supervisorPid: process.pid,
          supervisorUptimeSec: Math.round((now - supervisorStartedAt) / 1000),
          kernelPid: child?.pid ?? null,
          kernelRunning: Boolean(child),
          restarting,
          restarts: restartCount,
          startedAt: new Date(supervisorStartedAt).toISOString(),
          lastKernelStartAt: kernelStartedAt
            ? new Date(kernelStartedAt).toISOString()
            : null,
          lastKernelExitAt: lastKernelExitAt
            ? new Date(lastKernelExitAt).toISOString()
            : null,
          lastKernelExitCode,
          lastKernelExitSignal,
          controlSocketPath,
        };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
        return;
      }
      if (req.method === "POST" && req.url === "/restart") {
        await scheduleRestart();
        res.writeHead(202, { "content-type": "application/json" });
        res.end(JSON.stringify({ message: "restart scheduled" }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    controlServer.listen(controlSocketPath, () => {
      try {
        chmodSync(controlSocketPath, 0o600);
      } catch (error) {
        logger.warn({ error }, "[omnicore] failed to chmod control socket");
      }
      logger.info({ socketPath: controlSocketPath }, "[omnicore] control socket ready");
    });
  };

  startControlServer();

  const stopTail = eventStore.tail(async (event) => {
    const actionType = getActionType(event);
    if (actionType !== "restart") {
      return;
    }
    if (event.id === lastRestartEventId) {
      return;
    }
    lastRestartEventId = event.id;
    logger.info({ eventId: event.id }, "[omnicore] restart requested by event");
    await scheduleRestart();
  }, { fromEnd: true });

  const shutdown = async () => {
    if (stopping) {
      return;
    }
    stopping = true;
    if (controlServer) {
      await new Promise<void>((resolve) => {
        controlServer?.close(() => resolve());
      });
      controlServer = null;
      if (existsSync(controlSocketPath)) {
        unlinkSync(controlSocketPath);
      }
    }
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

  logger.info({ dbPath: config.dbPath }, "[omnicore] supervisor started");
  await waitForExit;
};
