import http from "http";
import path from "path";

import { loadDefaultWorkspaceRoot } from "./service";

export interface SupervisorStatus {
  supervisorPid: number;
  supervisorUptimeSec: number;
  kernelPid: number | null;
  kernelRunning: boolean;
  restarting: boolean;
  restarts: number;
  startedAt: string;
  lastKernelStartAt: string | null;
  lastKernelExitAt: string | null;
  lastKernelExitCode: number | null;
  lastKernelExitSignal: string | null;
  controlSocketPath: string;
}

const requestJson = (
  socketPath: string,
  method: "GET" | "POST",
  urlPath: string,
  timeoutMs = 1200
): Promise<unknown> => {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath, method, path: urlPath },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => {
          chunks.push(Buffer.from(chunk));
        });
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8").trim();
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(body || `Request failed: ${res.statusCode}`));
            return;
          }
          if (!body) {
            resolve(null);
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("Request timed out"));
    });
    req.end();
  });
};

const resolveServiceSocketPath = (): string => {
  if (process.env.OMNICORE_CONTROL_SOCKET) {
    return process.env.OMNICORE_CONTROL_SOCKET;
  }
  if (process.env.OMNICORE_DATA_DIR) {
    return path.join(process.env.OMNICORE_DATA_DIR, "supervisor.sock");
  }
  const root = loadDefaultWorkspaceRoot();
  return path.join(root, ".omnicore", "supervisor.sock");
};

const tryRequest = async (
  method: "GET" | "POST",
  urlPath: string
): Promise<{ socketPath: string; payload: unknown }> => {
  const socketPath = resolveServiceSocketPath();
  try {
    const payload = await requestJson(socketPath, method, urlPath);
    return { socketPath, payload };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to reach supervisor control socket at ${socketPath}: ${message}`);
  }
};

export const requestSupervisorStatus = async (): Promise<{
  socketPath: string;
  status: SupervisorStatus;
}> => {
  const result = await tryRequest("GET", "/status");
  return { socketPath: result.socketPath, status: result.payload as SupervisorStatus };
};

export const requestSupervisorRestart = async (): Promise<string> => {
  const result = await tryRequest("POST", "/restart");
  const payload = result.payload as { message?: string } | null;
  return payload?.message ?? "restart requested";
};
