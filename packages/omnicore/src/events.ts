import { randomUUID } from "crypto";

export type EventType =
  | "signal.inbound"
  | "signal.internal"
  | "system.pulse"
  | "session.created"
  | "session.archived"
  | "session.renamed"
  | "session.root.set"
  | "agent.run.start"
  | "agent.message"
  | "agent.summary"
  | "action.requested"
  | "action.executed";

export type ActionType =
  | "send_message"
  | "send_status"
  | "restart"
  | "tool_call";

export type InboundPayload = {
  kind: "message";
  text: string;
  metadata?: Record<string, unknown>;
};

export type InternalPayload = {
  kind: "heartbeat";
  source?: "scheduler";
  heartbeatPath?: string;
  heartbeatText?: string;
};

export type SystemPulsePayload = {
  source: "kernel";
};

export type SessionCreatedPayload = {
  title?: string;
  metadata?: Record<string, unknown>;
};

export type SessionArchivedPayload = {
  reason?: string;
};

export type SessionRenamedPayload = {
  title: string;
};

export type SessionRootSetPayload = {
  rootPath: string;
};

export type AgentRunStartPayload = {
  modelProvider?: string;
  modelName?: string;
};

export type ActionRequestedPayload = {
  action: Action;
};

export type ActionExecutedPayload = {
  action: Action;
  result: ActionResult;
};

export type AgentMessagePayload = {
  message: unknown;
};

export type AgentSummaryPayload = {
  summary: string;
};

export type EventPayload =
  | InboundPayload
  | InternalPayload
  | SystemPulsePayload
  | SessionCreatedPayload
  | SessionArchivedPayload
  | SessionRenamedPayload
  | SessionRootSetPayload
  | AgentRunStartPayload
  | AgentMessagePayload
  | AgentSummaryPayload
  | ActionRequestedPayload
  | ActionExecutedPayload;

export type Action =
  | { type: "send_message"; actorId: string; text: string }
  | { type: "send_status"; actorId: string; status: { kind: "thinking"; phase: "start" | "end" } }
  | { type: "restart"; reason?: string }
  | { type: "tool_call"; toolName: string; args: Record<string, unknown>; toolCallId?: string };

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
  sessionId: string;
  causationId?: string;
  payload: TPayload;
}

export const DEFAULT_SESSION_ID = "session:default";
export const SYSTEM_SESSION_ID = "session:system";

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
