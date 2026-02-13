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
  AGENT_BASH_ALLOWLIST: z.string().optional(),
})

export type AgentRuntimeConfig = {
  provider: string
  model: string
  systemPrompt: string
  thinkingLevel: ThinkingLevel
  bashAllowlist: string[]
}

export const loadAgentConfig = (options?: { cwd?: string }): AgentRuntimeConfig => {
  const env = loadEnv(schema, options)
  const allowlist = env.AGENT_BASH_ALLOWLIST?.split(",").map((item: string) => item.trim())
  return {
    provider: env.AGENT_PROVIDER,
    model: env.AGENT_MODEL,
    systemPrompt: env.AGENT_SYSTEM_PROMPT ?? "",
    thinkingLevel: env.AGENT_THINKING_LEVEL ?? "off",
    bashAllowlist: allowlist?.filter(Boolean) ?? [],
  }
}
