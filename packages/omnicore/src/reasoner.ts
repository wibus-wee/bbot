import { runAgent } from "@bbot/agent";
import type { AgentEvent, AgentMessage, AgentRuntimeConfig } from "@bbot/agent";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";

import type { Action, Event } from "./events";
import { createEvent } from "./events";

export interface ReasonerInput {
  event: Event;
  instructions: string;
  workspaceRoot: string;
  modelProvider?: string;
  modelName?: string;
  baseUrl?: string;
  thinkingLevel?: ThinkingLevel;
  apiKey?: string;
  actorId: string | null;
  contextMessages?: AgentMessage[];
  emitStatus?: (status: { kind: "thinking"; phase: "start" | "end" }) => Promise<void>;
  logEvent: (event: Event) => Promise<void>;
}

export interface ReasonerOutput {
  replyText?: string;
  requestRestart?: boolean;
}

const isAssistantMessage = (message: AgentMessage | null): message is AssistantMessage => {
  if (!message || typeof message !== "object") {
    return false;
  }
  const candidate = message as AssistantMessage;
  return candidate.role === "assistant" && Array.isArray(candidate.content);
};

const extractText = (message: AgentMessage | null): string => {
  if (!isAssistantMessage(message)) {
    return "";
  }
  const blocks = message.content ?? [];
  return blocks
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
};

const buildPrompt = (event: Event, instructions: string): string => {
  const summary = {
    type: event.type,
    actorId: event.actorId,
    sessionId: event.sessionId,
    payload: event.payload,
  };
  return `Instructions:\n${instructions || "(empty)"}\n\nEvent:\n${JSON.stringify(
    summary,
    null,
    2
  )}`;
};

const logToolEvent = async (
  input: ReasonerInput,
  toolName: string,
  args: Record<string, unknown>,
  phase: "start" | "end",
  toolCallId?: string,
  result?: unknown,
  isError?: boolean
) => {
  const action: Action = {
    type: "tool_call",
    toolName,
    args,
    toolCallId,
  };

  if (phase === "start") {
    const event = createEvent({
      type: "action.requested",
      actorId: input.actorId,
      traceId: input.event.traceId,
      sessionId: input.event.sessionId,
      causationId: input.event.id,
      payload: { action },
    });
    await input.logEvent(event);
    return;
  }

  const event = createEvent({
    type: "action.executed",
    actorId: input.actorId,
    traceId: input.event.traceId,
    sessionId: input.event.sessionId,
    causationId: input.event.id,
    payload: {
      action,
      result: {
        ok: !isError,
        data: { result },
        error: isError ? "tool error" : undefined,
      },
    },
  });
  await input.logEvent(event);
};

export const decideActions = async (input: ReasonerInput): Promise<ReasonerOutput> => {
  if (!input.modelProvider || !input.modelName) {
    if (input.event.type === "signal.inbound") {
      return { replyText: "LLM is not configured. Set a provider/model to enable." };
    }
    return {};
  }

  let requestRestart = false;
  let thinkingActive = false;
  const config: AgentRuntimeConfig = {
    provider: input.modelProvider,
    model: input.modelName,
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    systemPrompt: "",
    promptProfile: "free",
    appendSystemPrompt: undefined,
    compaction: {
      enabled: true,
      reserveTokens: 16384,
      keepRecentTokens: 20000,
    },
    thinkingLevel: input.thinkingLevel,
    mcpServers: [],
  };

  const prompt = buildPrompt(input.event, input.instructions);

  const onEvent = async (event: AgentEvent) => {
    if (event.type === "message_end") {
      const message = event.message as AgentMessage | undefined;
      if (
        input.actorId &&
        message &&
        typeof message === "object" &&
        "role" in message &&
        (message as { role?: string }).role === "assistant"
      ) {
        const agentEvent = createEvent({
          type: "agent.message",
          actorId: input.actorId,
          traceId: input.event.traceId,
          sessionId: input.event.sessionId,
          causationId: input.event.id,
          payload: { message },
        });
        await input.logEvent(agentEvent);
      }
      if (thinkingActive && input.emitStatus) {
        thinkingActive = false;
        await input.emitStatus({ kind: "thinking", phase: "end" });
      }
    }
    if (event.type === "message_update" && input.emitStatus) {
      const messageEvent = event.assistantMessageEvent as { type?: string } | undefined;
      if (messageEvent?.type === "thinking_start" && !thinkingActive) {
        thinkingActive = true;
        await input.emitStatus({ kind: "thinking", phase: "start" });
      }
      if (messageEvent?.type === "thinking_end" && thinkingActive) {
        thinkingActive = false;
        await input.emitStatus({ kind: "thinking", phase: "end" });
      }
    }
    if (event.type === "tool_execution_start") {
      await logToolEvent(input, event.toolName, event.args ?? {}, "start", event.toolCallId);
    }
    if (event.type === "tool_execution_end") {
      await logToolEvent(
        input,
        event.toolName,
        event.result ?? {},
        "end",
        event.toolCallId,
        event.result,
        event.isError
      );
    }
  };

  const result = await runAgent({
    prompt,
    workspaceRoot: input.workspaceRoot,
    config,
    onEvent,
    contextMessages: input.contextMessages,
  });

  const messages = result.state.messages;
  const lastAssistant = [...messages].reverse().find((message) =>
    typeof message === "object" && message !== null && "role" in message && (message as { role?: string }).role === "assistant"
  ) as AgentMessage | undefined;

  const replyText = extractText(lastAssistant ?? null);
  if (replyText) {
    return { replyText, requestRestart };
  }
  return requestRestart ? { requestRestart: true } : {};
};
