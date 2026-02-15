import { runAgent } from "@bbot/agent";
import type { AgentEvent, AgentMessage, AgentRuntimeConfig } from "@bbot/agent";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";

import type { Action, ActionResult, Event } from "./events";
import { createEvent } from "./events";

export interface ReasonerInput {
  event: Event;
  instructions: string;
  workspaceRoot: string;
  modelProvider?: string;
  modelName?: string;
  apiKey?: string;
  actorId: string | null;
  executeAction: (action: Action) => Promise<ActionResult>;
  logEvent: (event: Event) => Promise<void>;
}

export interface ReasonerOutput {
  replyText?: string;
  requestRestart?: boolean;
}

const DEFAULT_SYSTEM_PROMPT = `You are OmniCore, a channel-agnostic kernel.
You only know events and actions. Never mention Telegram or Discord.
Use tools when you need to read or change files, run bash, or request restart.
Prefer edit/write tools for file changes so restarts are automatic.
After changing code, always request a restart.`;

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

const ruleBased = async (input: ReasonerInput): Promise<ReasonerOutput> => {
  if (input.event.type !== "signal.inbound") {
    return {};
  }

  const payload = input.event.payload as { text?: string };
  const text = payload.text?.trim() ?? "";
  if (!text) {
    return {};
  }

  if (text.startsWith("!bash ")) {
    const command = text.replace("!bash ", "").trim();
    await input.executeAction({ type: "run_bash", command });
    return { replyText: "bash command executed" };
  }

  if (text.startsWith("!read ")) {
    const path = text.replace("!read ", "").trim();
    await input.executeAction({ type: "read_file", path });
    return { replyText: `read ${path}` };
  }

  if (text.startsWith("!write ")) {
    const rest = text.slice("!write ".length);
    const [pathPart, contentPart] = rest.split("::");
    const filePath = pathPart?.trim();
    const content = contentPart?.trim() ?? "";
    if (filePath) {
      await input.executeAction({ type: "write_file", path: filePath, content });
      return { replyText: `wrote ${filePath}` };
    }
  }

  if (text.startsWith("!restart")) {
    await input.executeAction({ type: "restart", reason: "cli request" });
    return { replyText: "restart requested" };
  }

  return { replyText: `ack: ${text}` };
};

export const decideActions = async (input: ReasonerInput): Promise<ReasonerOutput> => {
  if (!input.modelProvider || !input.modelName) {
    return ruleBased(input);
  }

  let requestRestart = false;
  const config: AgentRuntimeConfig = {
    provider: input.modelProvider,
    model: input.modelName,
    apiKey: input.apiKey,
    systemPrompt: input.instructions.trim() || DEFAULT_SYSTEM_PROMPT,
    promptProfile: "free",
    appendSystemPrompt: undefined,
    compaction: {
      enabled: true,
      reserveTokens: 16384,
      keepRecentTokens: 20000,
    },
    thinkingLevel: undefined,
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
