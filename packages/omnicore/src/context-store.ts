import { promises as fs } from "fs";
import path from "path";

import type { Context } from "@mariozechner/pi-ai";

export interface StoredContext {
  systemPrompt: string;
  messages: Context["messages"];
}

export const loadContext = async (
  filePath: string,
  fallbackSystemPrompt: string
): Promise<StoredContext> => {
  try {
    const contents = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(contents) as StoredContext;
    return {
      systemPrompt: parsed.systemPrompt ?? fallbackSystemPrompt,
      messages: parsed.messages ?? [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { systemPrompt: fallbackSystemPrompt, messages: [] };
    }
    throw error;
  }
};

export const saveContext = async (
  filePath: string,
  context: StoredContext,
  maxMessages = 40
): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const trimmed = {
    systemPrompt: context.systemPrompt,
    messages: context.messages.slice(-maxMessages),
  } satisfies StoredContext;
  await fs.writeFile(filePath, JSON.stringify(trimmed, null, 2), "utf-8");
};
