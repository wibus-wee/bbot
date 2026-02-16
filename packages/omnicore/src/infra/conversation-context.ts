import type { AgentMessage } from "@bbot/agent";
import { buildContextMessages } from "@bbot/agent";
import type { AssistantMessage, ToolResultMessage, Usage } from "@mariozechner/pi-ai";

import type { StoredEvent, SqliteEventStore } from "./event-store";
import type { Action, Event } from "../domain/events";

const DEFAULT_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

type ConversationEntry = {
  kind: "message" | "summary";
  payload: unknown;
  sequence: number;
};

export type ConversationEntriesResult = {
  entries: ConversationEntry[];
  usageTokens: number;
  lastSummarySeq: number | null;
};

const toTimestamp = (value: string): number => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isAgentMessage = (value: unknown): value is AgentMessage => {
  if (!value || typeof value !== "object") return false;
  if (!("role" in value)) return false;
  const role = (value as { role?: string }).role;
  if (role === "user" || role === "assistant") {
    return "content" in value;
  }
  if (role === "toolResult") {
    return "content" in value && "toolCallId" in value && "toolName" in value;
  }
  return false;
};

const extractUsageTokens = (message: AgentMessage): number => {
  if (!message || typeof message !== "object") return 0;
  if (!("role" in message) || message.role !== "assistant") return 0;
  const usage = (message as AssistantMessage).usage;
  const total = usage?.totalTokens;
  return typeof total === "number" && Number.isFinite(total) ? total : 0;
};

const toTextContent = (value: unknown): Array<{ type: "text"; text: string }> => {
  if (typeof value === "string") {
    return [{ type: "text", text: value }];
  }
  return [{ type: "text", text: JSON.stringify(value) }];
};

const toAssistantMessage = (text: string, timestamp: string): AssistantMessage => ({
  role: "assistant",
  content: [{ type: "text", text }],
  api: "unknown",
  provider: "unknown",
  model: "unknown",
  usage: DEFAULT_USAGE,
  stopReason: "stop",
  timestamp: toTimestamp(timestamp),
});

type ToolCallAction = Extract<Action, { type: "tool_call" }>;

const toToolResultMessage = (
  action: ToolCallAction,
  event: Event,
  result: unknown,
  ok: boolean
): ToolResultMessage => {
  const toolResult = isRecord(result) ? result : null;
  const content = Array.isArray(toolResult?.content)
    ? (toolResult?.content as ToolResultMessage["content"])
    : toTextContent(toolResult ?? result);

  return {
    role: "toolResult",
    toolCallId: action.toolCallId ?? event.id,
    toolName: action.toolName,
    content,
    details: toolResult?.details,
    isError: !ok,
    timestamp: toTimestamp(event.timestamp),
  };
};

const findLastSummary = (rows: StoredEvent[]) => {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (!row) continue;
    if (row.event.type === "agent.summary") {
      const payload = row.event.payload as { summary?: string };
      if (payload?.summary) {
        return { seq: row.seq, summary: payload.summary };
      }
    }
  }
  return null;
};

const collectAssistantTraceIds = (rows: StoredEvent[], minSeq: number): Set<string> => {
  const traceIds = new Set<string>();
  for (const row of rows) {
    if (row.seq <= minSeq) continue;
    const event = row.event;
    if (event.type !== "agent.message") continue;
    const payload = event.payload as { message?: unknown };
    if (!isAgentMessage(payload?.message)) continue;
    const message = payload.message as AgentMessage;
    if (message.role === "assistant") {
      traceIds.add(event.traceId);
    }
  }
  return traceIds;
};

const buildEntriesFromEvent = (
  row: StoredEvent,
  assistantTraceIds: Set<string>
): ConversationEntry[] => {
  const event = row.event;

  if (event.type === "agent.message") {
    const payload = event.payload as { message?: unknown };
    if (!isAgentMessage(payload?.message)) return [];
    return [{ kind: "message", payload: payload.message, sequence: row.seq }];
  }

  if (event.type === "signal.inbound") {
    const payload = event.payload as { text?: string };
    const text = payload.text?.trim();
    if (!text) return [];
    return [
      {
        kind: "message",
        payload: {
          role: "user",
          content: text,
          timestamp: toTimestamp(event.timestamp),
        },
        sequence: row.seq,
      },
    ];
  }

  if (event.type === "action.requested") {
    const payload = event.payload as { action?: Action };
    const action = payload.action;
    if (action?.type === "send_message") {
      if (assistantTraceIds.has(event.traceId)) {
        return [];
      }
      const text = action.text?.trim();
      if (!text) return [];
      return [{ kind: "message", payload: toAssistantMessage(text, event.timestamp), sequence: row.seq }];
    }
  }

  if (event.type === "action.executed") {
    const payload = event.payload as { action?: Action; result?: { ok?: boolean; data?: { result?: unknown } } };
    const action = payload.action;
    if (action?.type === "tool_call") {
      const result = payload.result?.data?.result ?? payload.result ?? null;
      return [{ kind: "message", payload: toToolResultMessage(action, event, result, payload.result?.ok ?? false), sequence: row.seq }];
    }
  }

  return [];
};

export const collectConversationEntries = (
  eventStore: SqliteEventStore,
  sessionId: string,
  options: { limit?: number; excludeEventId?: string; scanLimit?: number } = {}
): ConversationEntriesResult => {
  const limit = options.limit ?? 40;
  const scanLimit = options.scanLimit ?? 2000;
  const rows = eventStore.readRecentWithSeq(scanLimit)
    .filter((row) => !options.excludeEventId || row.event.id !== options.excludeEventId)
    .filter((row) => row.event.sessionId === sessionId);

  const summary = findLastSummary(rows);
  const lastSummarySeq = summary?.seq ?? 0;
  const assistantTraceIds = collectAssistantTraceIds(rows, lastSummarySeq);

  const messageEntries: ConversationEntry[] = [];
  let usageTokens = 0;

  for (const row of rows) {
    if (row.seq <= lastSummarySeq) continue;
    const entries = buildEntriesFromEvent(row, assistantTraceIds);
    for (const entry of entries) {
      if (entry.kind === "message" && isAgentMessage(entry.payload)) {
        usageTokens += extractUsageTokens(entry.payload);
      }
      messageEntries.push(entry);
    }
  }

  const trimmedMessages = messageEntries.length > limit ? messageEntries.slice(-limit) : messageEntries;
  const summaryEntry: ConversationEntry | null = summary
    ? { kind: "summary", payload: { summary: summary.summary }, sequence: summary.seq }
    : null;
  const entries = summaryEntry ? [summaryEntry, ...trimmedMessages] : trimmedMessages;

  return {
    entries,
    usageTokens,
    lastSummarySeq: summary?.seq ?? null,
  };
};

export const buildConversationContext = (entries: ConversationEntry[]): AgentMessage[] => {
  return buildContextMessages(entries);
};
