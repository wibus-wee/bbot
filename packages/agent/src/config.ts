import { z } from "zod"

import { loadEnv } from "@bbot/shared"
import type { ThinkingLevel } from "@mariozechner/pi-agent-core"

const thinkingLevels = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const satisfies ThinkingLevel[]

const schema = z.object({
  AGENT_PROVIDER: z.string().min(1),
  AGENT_MODEL: z.string().min(1),
  AGENT_SYSTEM_PROMPT: z.string().optional(),
  AGENT_THINKING_LEVEL: z.enum(thinkingLevels).optional(),
})

export type AgentRuntimeConfig = {
  provider: string
  model: string
  systemPrompt: string
  thinkingLevel: ThinkingLevel
}

export const loadAgentConfig = (options?: { cwd?: string }): AgentRuntimeConfig => {
  const env = loadEnv(schema, options)
  return {
    provider: env.AGENT_PROVIDER,
    model: env.AGENT_MODEL,
    systemPrompt: env.AGENT_SYSTEM_PROMPT ?? "",
    thinkingLevel: env.AGENT_THINKING_LEVEL ?? "off",
  }
}
