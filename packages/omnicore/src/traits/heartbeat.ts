import { SYSTEM_SESSION_ID, createEvent, createTraceId, type Event } from "../events";
import type { HeartbeatTrait } from "./types";

export const createHeartbeatTrait = (intervalMs: number): HeartbeatTrait => {
  return {
    kind: "heartbeat",
    start: (emit: (event: Event) => Promise<void>) => {
      const timer = setInterval(() => {
        const event = createEvent({
          type: "system.pulse",
          actorId: null,
          traceId: createTraceId(),
          sessionId: SYSTEM_SESSION_ID,
          payload: {
            source: "kernel",
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
