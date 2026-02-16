import readline from "readline";
import { randomUUID } from "crypto";
import { createLogger } from "@bbot/shared";
import { createEvent, createTraceId } from "../domain/events";
import { AdapterClient } from "../sdk/adapter-client";
import type { KernelAction } from "../domain/adapter-protocol";

export const runCliAdapter = (): void => {
  const logger = createLogger({ name: "omnicore.cli-adapter" });
  const logInfo = (message: string) => {
    console.log(message);
    logger.info(message);
  };
  const logError = (message: string, error?: unknown) => {
    if (error) {
      console.error(message, error);
      logger.error({ error }, message);
      return;
    }
    console.error(message);
    logger.error(message);
  };

  const adapterId = process.env.OMNICORE_ADAPTER_ID ?? "cli";
  const url = process.env.OMNICORE_ADAPTER_URL ?? "ws://localhost:8787";
  const initialSessionId = process.env.OMNICORE_SESSION_ID ?? `session:${randomUUID()}`;

  let currentSessionId = initialSessionId;
  let sessionCreatedSent = false;
  const client = new AdapterClient({
    adapterId,
    url,
    capabilities: ["send_message", "send_status", "event_in"],
    onAction: (data: KernelAction) => {
      if (data.type === "action" && data.action.type === "send_message") {
        const prefix = data.sessionId !== currentSessionId
          ? `[omnicore][${data.sessionId}] `
          : "[omnicore] ";
        process.stdout.write(`\n${prefix}${data.action.text}\n`);
      }
      if (data.type === "action" && data.action.type === "send_status") {
        if (data.action.status.kind === "thinking") {
          const prefix = data.sessionId !== currentSessionId
            ? `[omnicore][${data.sessionId}] `
            : "[omnicore] ";
          const label = data.action.status.phase === "start" ? "thinking..." : "thinking done";
          process.stdout.write(`\n${prefix}${label}\n`);
        }
        if (data.action.status.kind === "tool") {
          const prefix = data.sessionId !== currentSessionId
            ? `[omnicore][${data.sessionId}] `
            : "[omnicore] ";
          const summary = formatToolSummary(
            data.action.status.toolName,
            data.action.status.args
          );
          const phaseLabel = data.action.status.phase === "start"
            ? "tool:start"
            : data.action.status.ok === false
              ? "tool:error"
              : "tool:end";
          const suffix = data.action.status.phase === "end" && data.action.status.ok === false
            ? " (error)"
            : "";
          process.stdout.write(`\n${prefix}${phaseLabel} ${summary}${suffix}\n`);
        }
      }
    },
    onOpen: () => {
      if (!sessionCreatedSent) {
        emitSessionCreated(currentSessionId);
      }
      setSessionId(currentSessionId, false);
      logInfo("[omnicore] adapter connected");
    },
    onReconnect: (delay) => {
      logInfo(`[omnicore] adapter disconnected, reconnecting in ${delay}ms`);
    },
    onError: (error) => {
      logError("[omnicore] adapter error", error);
    },
  });

  const emitSessionCreated = (sessionId: string) => {
    const event = createEvent({
      type: "session.created",
      actorId: `${adapterId}:local`,
      traceId: createTraceId(),
      sessionId,
      payload: {},
    });
    client.sendEvent(event);
    sessionCreatedSent = true;
  };

  const setSessionId = (sessionId: string, announce = true) => {
    currentSessionId = sessionId;
    if (announce) {
      process.stdout.write(`\n[omnicore] session: ${currentSessionId}\n`);
    }
  };

  const printHelp = () => {
    process.stdout.write("\n[omnicore] commands: /session | /new | /use <sessionId>\n");
  };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  rl.on("line", (line) => {
    const text = line.trim();
    if (!text) {
      return;
    }
    if (text.startsWith("/")) {
      if (text === "/session") {
        process.stdout.write(`\n[omnicore] session: ${currentSessionId}\n`);
        return;
      }
      if (text === "/new") {
        const nextSessionId = `session:${randomUUID()}`;
        emitSessionCreated(nextSessionId);
        setSessionId(nextSessionId);
        return;
      }
      if (text.startsWith("/use ")) {
        const nextSessionId = text.slice(5).trim();
        if (!nextSessionId) {
          process.stdout.write("\n[omnicore] usage: /use <sessionId>\n");
          return;
        }
        setSessionId(nextSessionId);
        return;
      }
      printHelp();
      return;
    }
    const event = createEvent({
      type: "signal.inbound",
      actorId: `${adapterId}:local`,
      traceId: createTraceId(),
      sessionId: currentSessionId,
      payload: {
        kind: "message",
        text,
      },
    });
    client.sendEvent(event);
  });

  client.connect();
};

const formatToolSummary = (
  toolName: string,
  args: Record<string, unknown> | undefined
): string => {
  if (!args || typeof args !== "object") {
    return toolName;
  }

  const preferredKeys = [
    "path",
    "file",
    "files",
    "dir",
    "cwd",
    "command",
    "cmd",
    "pattern",
    "query",
    "glob",
  ];

  const entries: string[] = [];
  for (const key of preferredKeys) {
    if (key in args) {
      const value = (args as Record<string, unknown>)[key];
      entries.push(`${key}=${formatToolValue(value)}`);
    }
  }

  if (entries.length === 0) {
    const rawEntries = Object.entries(args).slice(0, 2);
    for (const [key, value] of rawEntries) {
      entries.push(`${key}=${formatToolValue(value)}`);
    }
  }

  if (entries.length === 0) {
    return toolName;
  }
  return `${toolName} ${entries.join(" ")}`;
};

const formatToolValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "string") {
    return truncate(value, 120);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return truncate(JSON.stringify(value), 120);
  } catch {
    return String(value);
  }
};

const truncate = (value: string, max: number): string => {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 3)}...`;
};
