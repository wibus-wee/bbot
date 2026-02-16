import readline from "readline";
import { randomUUID } from "crypto";
import { createEvent, createTraceId } from "../domain/events";
import { AdapterClient } from "../sdk/adapter-client";
import type { KernelAction } from "../domain/adapter-protocol";

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
    }
  },
  onOpen: () => {
    if (!sessionCreatedSent) {
      emitSessionCreated(currentSessionId);
    }
    setSessionId(currentSessionId, false);
    console.log("[omnicore] adapter connected");
  },
  onReconnect: (delay) => {
    console.log(`[omnicore] adapter disconnected, reconnecting in ${delay}ms`);
  },
  onError: (error) => {
    console.error("[omnicore] adapter error", error);
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
  process.stdout.write(
    "\n[omnicore] commands: /session | /new | /use <sessionId>\n"
  );
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
