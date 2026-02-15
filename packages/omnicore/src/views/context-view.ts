import { promises as fs } from "fs";
import path from "path";

import type { Event } from "../events";

export interface ContextView {
  updatedAt: string;
  inboundMessages: Array<{ actorId: string | null; text: string; timestamp: string }>;
  actions: Array<{ type: string; ok?: boolean; timestamp: string }>;
}

export const buildContextView = (events: Event[], limit = 50): ContextView => {
  const inboundMessages = events
    .filter((event) => event.type === "signal.inbound")
    .slice(-limit)
    .map((event) => ({
      actorId: event.actorId,
      text: (event.payload as { text?: string }).text ?? "",
      timestamp: event.timestamp,
    }));

  const actions = events
    .filter((event) => event.type === "action.executed")
    .slice(-limit)
    .map((event) => ({
      type: (event.payload as { action?: { type?: string } }).action?.type ?? "unknown",
      ok: (event.payload as { result?: { ok?: boolean } }).result?.ok,
      timestamp: event.timestamp,
    }));

  return {
    updatedAt: new Date().toISOString(),
    inboundMessages,
    actions,
  };
};

export const writeContextView = async (filePath: string, view: ContextView): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(view, null, 2), "utf-8");
};
