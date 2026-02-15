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
  result?: unknown,
  isError?: boolean
) => {
  const action: Action = {
    type: "tool_call",
    toolName,
    args,
  };

  if (phase === "start") {
    const event = createEvent({
      type: "action.requested",
      actorId: input.actorId,
      traceId: input.event.traceId,
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
  const config: AgentRuntimeConfig = {
    provider: input.modelProvider,
    model: input.modelName,
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    systemPrompt: undefined,
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
    if (event.type === "tool_execution_start") {
      await logToolEvent(input, event.toolName, event.args ?? {}, "start");
    }
    if (event.type === "tool_execution_end") {
      if (event.toolName === "write" || event.toolName === "edit") {
        requestRestart = true;
      }
      await logToolEvent(input, event.toolName, event.result ?? {}, "end", event.result, event.isError);
    }
  };

  const result = await runAgent({
    prompt,
    workspaceRoot: input.workspaceRoot,
    config,
    onEvent,
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
