import type { Context } from "@mariozechner/pi-ai";

import type { KvStore } from "./kv-store";

export interface StoredContext {
  systemPrompt: string;
  messages: Context["messages"];
}

const CONTEXT_KEY = "llm_context";

export const loadContext = (store: KvStore, fallbackSystemPrompt: string): StoredContext => {
  const raw = store.get(CONTEXT_KEY);
  if (!raw) {
    return { systemPrompt: fallbackSystemPrompt, messages: [] };
  }
  try {
    const parsed = JSON.parse(raw) as StoredContext;
    return {
      systemPrompt: parsed.systemPrompt ?? fallbackSystemPrompt,
      messages: parsed.messages ?? [],
    };
  } catch {
    return { systemPrompt: fallbackSystemPrompt, messages: [] };
  }
};

export const saveContext = (store: KvStore, context: StoredContext, maxMessages = 40): void => {
  const trimmed = {
    systemPrompt: context.systemPrompt,
    messages: context.messages.slice(-maxMessages),
  } satisfies StoredContext;
  store.set(CONTEXT_KEY, JSON.stringify(trimmed));
};
