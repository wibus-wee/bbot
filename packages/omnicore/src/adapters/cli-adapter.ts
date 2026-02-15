import readline from "readline";
import { randomUUID } from "crypto";
import WebSocket, { type RawData } from "ws";

import { createEvent, createTraceId } from "../events";
import type { AdapterMessage, KernelMessage } from "./protocol";

const adapterId = process.env.OMNICORE_ADAPTER_ID ?? "cli";
const url = process.env.OMNICORE_ADAPTER_URL ?? "ws://localhost:8787";
const initialSessionId = process.env.OMNICORE_SESSION_ID ?? `session:${randomUUID()}`;

const socket = new WebSocket(url);

const send = (message: AdapterMessage) => {
  socket.send(JSON.stringify(message));
};

let currentSessionId = initialSessionId;

const emitSessionCreated = (sessionId: string) => {
  const event = createEvent({
    type: "session.created",
    actorId: `${adapterId}:local`,
    traceId: createTraceId(),
    sessionId,
    payload: {},
  });
  send({ type: "event", event });
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

socket.on("open", () => {
  send({ type: "hello", adapterId });
  emitSessionCreated(currentSessionId);
  setSessionId(currentSessionId);
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
    send({ type: "event", event });
  });
});

socket.on("message", (raw: RawData) => {
  const data = JSON.parse(raw.toString()) as KernelMessage;
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
});

socket.on("close", () => {
  console.log("[omnicore] adapter disconnected");
  process.exit(0);
});

socket.on("error", (error: Error) => {
  console.error("[omnicore] adapter error", error);
});
