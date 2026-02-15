import { randomUUID } from "crypto";

export type EventType =
  | "signal.inbound"
  | "signal.internal"
  | "action.requested"
  | "action.executed";

export type ActionType =
  | "send_message"
  | "run_bash"
  | "write_file"
  | "read_file"
  | "restart";

export type InboundPayload = {
  kind: "message";
  text: string;
  metadata?: Record<string, unknown>;
};

export type InternalPayload = {
  kind: "heartbeat";
};

export type ActionRequestedPayload = {
  action: Action;
};

export type ActionExecutedPayload = {
  action: Action;
  result: ActionResult;
};

export type EventPayload =
  | InboundPayload
  | InternalPayload
  | ActionRequestedPayload
  | ActionExecutedPayload;

export type Action =
  | { type: "send_message"; actorId: string; text: string }
  | { type: "run_bash"; command: string }
  | { type: "write_file"; path: string; content: string }
  | { type: "read_file"; path: string }
  | { type: "restart"; reason?: string };

export type ActionResult = {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
};

export interface Event<TPayload extends EventPayload = EventPayload> {
  id: string;
  type: EventType;
  timestamp: string;
  actorId: string | null;
  traceId: string;
  causationId?: string;
  payload: TPayload;
}

export const createEvent = <TPayload extends EventPayload>(
  input: Omit<Event<TPayload>, "id" | "timestamp">
): Event<TPayload> => ({
  ...input,
  id: randomUUID(),
  timestamp: new Date().toISOString(),
});

export const createTraceId = (): string => randomUUID();

export const isActionRequested = (event: Event): event is Event<ActionRequestedPayload> =>
  event.type === "action.requested";

export const isActionExecuted = (event: Event): event is Event<ActionExecutedPayload> =>
  event.type === "action.executed";

export const isInboundSignal = (event: Event): event is Event<InboundPayload> =>
  event.type === "signal.inbound";

export const isInternalSignal = (event: Event): event is Event<InternalPayload> =>
  event.type === "signal.internal";
