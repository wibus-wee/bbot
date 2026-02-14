import { z } from "zod"

import { loadEnv } from "@bbot/shared"
import type { ThinkingLevel } from "@mariozechner/pi-agent-core"

import { parseMcpServers, type McpServerConfig } from "./mcp/config"

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
  AGENT_BASE_URL: z.string().url().optional(),
  AGENT_SYSTEM_PROMPT: z.string().optional(),
  AGENT_PROMPT_PROFILE: z.enum(["coding", "free"]).optional(),
  AGENT_APPEND_SYSTEM_PROMPT: z.string().optional(),
  AGENT_COMPACTION_ENABLED: z.coerce.boolean().optional(),
  AGENT_COMPACTION_RESERVE_TOKENS: z.coerce.number().int().positive().optional(),
  AGENT_COMPACTION_KEEP_RECENT_TOKENS: z.coerce.number().int().positive().optional(),
  AGENT_THINKING_LEVEL: z.enum(thinkingLevels).optional(),
  AGENT_MCP_SERVERS: z.string().optional(),
  ACP_COMMAND: z.string().min(1).optional(),
  ACP_ARGS: z.string().optional(),
  ACP_BASE_URL: z.string().url().optional(),
  ACP_AGENT_NAME: z.string().min(1).optional(),
  ACP_API_TOKEN: z.string().min(1).optional(),
})

export type AgentRuntimeConfig = {
  provider: string
  model: string
  baseUrl?: string
  headers?: Record<string, string>
  apiKey?: string
  systemPrompt: string
  promptProfile?: "coding" | "free"
  appendSystemPrompt?: string
  compaction: {
    enabled: boolean
    reserveTokens: number
    keepRecentTokens: number
  }
  thinkingLevel?: ThinkingLevel
  mcpServers: McpServerConfig[]
  acp?: {
    command?: string
    args?: string
    baseUrl?: string
    agentName?: string
    apiToken?: string
  }
}

export const loadAgentConfig = (options?: { cwd?: string }): AgentRuntimeConfig => {
  const env = loadEnv(schema, options)
  return {
    provider: env.AGENT_PROVIDER,
    model: env.AGENT_MODEL,
    baseUrl: env.AGENT_BASE_URL,
    systemPrompt: env.AGENT_SYSTEM_PROMPT ?? "",
    promptProfile: env.AGENT_PROMPT_PROFILE,
    appendSystemPrompt: env.AGENT_APPEND_SYSTEM_PROMPT,
    compaction: {
      enabled: env.AGENT_COMPACTION_ENABLED ?? true,
      reserveTokens: env.AGENT_COMPACTION_RESERVE_TOKENS ?? 16384,
      keepRecentTokens: env.AGENT_COMPACTION_KEEP_RECENT_TOKENS ?? 20000,
    },
    thinkingLevel: env.AGENT_THINKING_LEVEL,
    mcpServers: parseMcpServers(env.AGENT_MCP_SERVERS),
    acp: {
      command: env.ACP_COMMAND,
      args: env.ACP_ARGS,
      baseUrl: env.ACP_BASE_URL,
      agentName: env.ACP_AGENT_NAME,
      apiToken: env.ACP_API_TOKEN,
    },
  }
}
