import { createEvent, createTraceId, type Event } from "../events";
import type { HeartbeatTrait } from "./types";

export const createHeartbeatTrait = (intervalMs: number): HeartbeatTrait => {
  return {
    kind: "heartbeat",
    start: (emit: (event: Event) => Promise<void>) => {
      const timer = setInterval(() => {
        const event = createEvent({
          type: "signal.internal",
          actorId: null,
          traceId: createTraceId(),
          payload: {
            kind: "heartbeat",
          },
        });
        void emit(event);
      }, intervalMs);

      return () => {
        clearInterval(timer);
      };
    },
  };
};
