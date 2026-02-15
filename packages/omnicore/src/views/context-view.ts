import type { Event } from "../events";

export interface ContextView {
  updatedAt: string;
  inboundMessages: Array<{ actorId: string | null; text: string; timestamp: string }>;
  actions: Array<{ type: string; ok?: boolean; timestamp: string }>;
}

export const createEmptyContextView = (): ContextView => ({
  updatedAt: new Date().toISOString(),
  inboundMessages: [],
  actions: [],
});

export const applyEventToContextView = (
  view: ContextView,
  event: Event,
  limit = 50
): ContextView => {
  const next: ContextView = {
    updatedAt: new Date().toISOString(),
    inboundMessages: [...view.inboundMessages],
    actions: [...view.actions],
  };

  if (event.type === "signal.inbound") {
    const text = (event.payload as { text?: string }).text ?? "";
    next.inboundMessages.push({
      actorId: event.actorId,
      text,
      timestamp: event.timestamp,
    });
  }

  if (event.type === "action.executed") {
    const payload = event.payload as { action?: { type?: string }; result?: { ok?: boolean } };
    next.actions.push({
      type: payload.action?.type ?? "unknown",
      ok: payload.result?.ok,
      timestamp: event.timestamp,
    });
  }

  if (next.inboundMessages.length > limit) {
    next.inboundMessages = next.inboundMessages.slice(-limit);
  }
  if (next.actions.length > limit) {
    next.actions = next.actions.slice(-limit);
  }

  return next;
};

export const buildContextView = (events: Event[], limit = 50): ContextView => {
  let view = createEmptyContextView();
  for (const event of events) {
    view = applyEventToContextView(view, event, limit);
  }
  return view;
};
