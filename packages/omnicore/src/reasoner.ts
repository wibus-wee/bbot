import { complete, getModel, Type } from "@mariozechner/pi-ai";
import type { Context, Tool } from "@mariozechner/pi-ai";

import { loadContext, saveContext } from "./context-store";
import type { Action, ActionResult, Event } from "./events";

export interface ReasonerInput {
  event: Event;
  mission: string;
  contextPath: string;
  modelSpec?: string;
  actorId: string | null;
  executeAction: (action: Action) => Promise<ActionResult>;
}

export interface ReasonerOutput {
  replyText?: string;
}

const DEFAULT_SYSTEM_PROMPT = `You are OmniCore, a channel-agnostic kernel.
You only know events and actions. Never mention Telegram or Discord.
Use tools when you need to read or change files, run bash, or request restart.
After changing code, always request a restart.`;

const tools: Tool[] = [
  {
    name: "run_bash",
    description: "Run a bash command inside the sandbox",
    parameters: Type.Object({
      command: Type.String({ description: "Command to execute" }),
    }),
  },
  {
    name: "write_file",
    description: "Write a file inside the sandbox",
    parameters: Type.Object({
      path: Type.String({ description: "File path (relative to sandbox root)" }),
      content: Type.String({ description: "File contents" }),
    }),
  },
  {
    name: "read_file",
    description: "Read a file inside the sandbox",
    parameters: Type.Object({
      path: Type.String({ description: "File path (relative to sandbox root)" }),
    }),
  },
  {
    name: "request_restart",
    description: "Request a kernel restart after self-update",
    parameters: Type.Object({
      reason: Type.Optional(Type.String({ description: "Why restart is needed" })),
    }),
  },
  {
    name: "send_message",
    description: "Send a message back to the current actor",
    parameters: Type.Object({
      text: Type.String({ description: "Message text" }),
      actorId: Type.Optional(Type.String({ description: "Actor id override" })),
    }),
  },
];

type ToolCallBlock = {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

type TextBlock = {
  type: "text";
  text: string;
};

type ResponseMessage = {
  role: string;
  content: Array<ToolCallBlock | TextBlock>;
};

const isToolCall = (block: ToolCallBlock | TextBlock): block is ToolCallBlock =>
  block.type === "toolCall";

const isTextBlock = (block: ToolCallBlock | TextBlock): block is TextBlock =>
  block.type === "text";

const extractText = (message: ResponseMessage): string =>
  message.content.filter(isTextBlock).map((block) => block.text).join("");

const toString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const toAction = (
  call: ToolCallBlock,
  actorId: string | null
): Action | null => {
  switch (call.name) {
    case "run_bash": {
      const command = toString(call.arguments.command);
      return command ? { type: "run_bash", command } : null;
    }
    case "write_file": {
      const path = toString(call.arguments.path);
      const content = toString(call.arguments.content);
      if (!path || content === null) {
        return null;
      }
      return { type: "write_file", path, content };
    }
    case "read_file": {
      const path = toString(call.arguments.path);
      return path ? { type: "read_file", path } : null;
    }
    case "request_restart": {
      const reason = toString(call.arguments.reason) ?? undefined;
      return { type: "restart", reason };
    }
    case "send_message": {
      const text = toString(call.arguments.text);
      const actor = toString(call.arguments.actorId) ?? actorId;
      if (!text || !actor) {
        return null;
      }
      return { type: "send_message", actorId: actor, text };
    }
    default:
      return null;
  }
};

const buildEventMessage = (event: Event, mission: string): string => {
  const eventSummary = {
    type: event.type,
    actorId: event.actorId,
    payload: event.payload,
  };
  return `Mission:\n${mission || "(empty)"}\n\nEvent:\n${JSON.stringify(
    eventSummary,
    null,
    2
  )}`;
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
  if (!input.modelSpec) {
    return ruleBased(input);
  }

  const stored = await loadContext(input.contextPath, DEFAULT_SYSTEM_PROMPT);
  const context: Context = {
    systemPrompt: stored.systemPrompt,
    messages: [...stored.messages],
    tools,
  };

  context.messages.push({
    role: "user",
    content: [{ type: "text", text: buildEventMessage(input.event, input.mission) }],
    timestamp: Date.now(),
  } as Context["messages"][number]);

  const [provider, modelName] = input.modelSpec.split(":");
  if (!provider || !modelName) {
    return ruleBased(input);
  }
  const getModelUnsafe = getModel as unknown as (provider: string, model: string) => ReturnType<typeof getModel>;
  const model = getModelUnsafe(provider, modelName);

  let replyText = "";
  let iterations = 0;
  let pending = true;

  while (pending && iterations < 3) {
    iterations += 1;
    const response = (await complete(model, context)) as ResponseMessage;
    context.messages.push(response as Context["messages"][number]);

    const toolCalls = response.content.filter(isToolCall);
    if (toolCalls.length === 0) {
      replyText = extractText(response);
      pending = false;
      break;
    }

    for (const call of toolCalls) {
      const action = toAction(call, input.actorId);
      const result = action
        ? await input.executeAction(action)
        : ({ ok: false, error: "invalid tool arguments" } satisfies ActionResult);

      context.messages.push({
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: "text", text: JSON.stringify(result) }],
        isError: !result.ok,
        timestamp: Date.now(),
      } as Context["messages"][number]);
    }
  }

  await saveContext(input.contextPath, {
    systemPrompt: context.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    messages: context.messages,
  });

  return { replyText };
};
