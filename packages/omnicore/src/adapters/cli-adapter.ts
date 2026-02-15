import readline from "readline";
import WebSocket, { type RawData } from "ws";

import { createEvent, createTraceId } from "../events";
import type { AdapterMessage, KernelMessage } from "./protocol";

const adapterId = process.env.OMNICORE_ADAPTER_ID ?? "cli";
const url = process.env.OMNICORE_ADAPTER_URL ?? "ws://localhost:8787";

const socket = new WebSocket(url);

const send = (message: AdapterMessage) => {
  socket.send(JSON.stringify(message));
};

socket.on("open", () => {
  send({ type: "hello", adapterId });
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
    const event = createEvent({
      type: "signal.inbound",
      actorId: `${adapterId}:local`,
      traceId: createTraceId(),
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
    process.stdout.write(`\n[omnicore] ${data.action.text}\n`);
  }
});

socket.on("close", () => {
  console.log("[omnicore] adapter disconnected");
  process.exit(0);
});

socket.on("error", (error: Error) => {
  console.error("[omnicore] adapter error", error);
});
