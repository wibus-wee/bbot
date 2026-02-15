import readline from "readline";

import { createEvent, createTraceId, type Event } from "../events";
import type { ChannelTrait } from "./types";

export const createCliChannel = (): ChannelTrait => {
  let rl: readline.Interface | null = null;

  return {
    kind: "channel",
    id: "cli",
    start: (emit: (event: Event) => Promise<void>) => {
      rl = readline.createInterface({
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
          actorId: "actor:local",
          traceId: createTraceId(),
          payload: {
            kind: "message",
            text,
          },
        });
        void emit(event);
      });

      return () => {
        rl?.close();
        rl = null;
      };
    },
    sendMessage: async ({ text }) => {
      process.stdout.write(`\n[omnicore] ${text}\n`);
    },
  };
};
