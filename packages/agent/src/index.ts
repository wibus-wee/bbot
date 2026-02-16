import { Agent } from "@mariozechner/pi-agent-core"
import { getModel, KnownProvider } from "@mariozechner/pi-ai"
import { createLogger } from "@bbot/shared"

import type { AgentEvent, AgentMessage, AgentState } from "@mariozechner/pi-agent-core"

import { loadAgentConfig, type AgentRuntimeConfig } from "./config"
import { loadProjectContextFiles } from "./resource-loader"
import { expandSkillCommand } from "./skill-command"
import { loadSkills, type Skill } from "./skills"
import {
  buildSystemPrompt,
  buildSystemPromptUsage,
  type SystemPromptUsage,
} from "./system-prompt"
import { createAgentTools } from "./tools"
import { createMcpTools } from "./mcp/tools"

export type RunAgentOptions = {
  prompt: string
  workspaceRoot: string
  sessionId?: string
  config?: AgentRuntimeConfig
  onEvent?: (event: AgentEvent) => void
  contextMessages?: AgentMessage[]
  abortSignal?: AbortSignal
}

export type RunAgentResult = {
  state: AgentState
  skills: Skill[]
}

const logger = createLogger({ name: "agent" })

export const runAgent = async (options: RunAgentOptions): Promise<RunAgentResult> => {
  const config = options.config ?? loadAgentConfig()
  const skills = loadSkills({ workspaceRoot: options.workspaceRoot })
  const expandedPrompt = expandSkillCommand(options.prompt, skills)

  const baseTools = createAgentTools({
    workspaceRoot: options.workspaceRoot,
  })
  const mcp = await createMcpTools({
    servers: config.mcpServers,
    logger: (message) => {
      logger.error({ message }, "[agent] mcp error")
    },
  })
  const tools = [...baseTools, ...mcp.tools]
  const contextFiles = loadProjectContextFiles({
    cwd: options.workspaceRoot,
    includeMemory: config.injectMemory ?? false,
  })
  const systemPrompt = buildSystemPrompt({
    customPrompt: config.systemPrompt?.trim() ? config.systemPrompt : undefined,
    promptProfile: config.promptProfile,
    appendSystemPrompt: config.appendSystemPrompt,
    cwd: options.workspaceRoot,
    modelName: config.model,
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
    })),
    contextFiles,
    skills,
  })

  // @ts-expect-error - We need to cast here because the config is loaded at runtime and we can't guarantee that it will always match the expected types. We should add validation to ensure that the config is correct.
  const baseModel = getModel(config.provider as KnownProvider, config.model)
  if (!baseModel) {
    throw new Error(
      `Unknown model ${config.model} for provider ${config.provider}`,
    )
  }
  const model = {
    ...baseModel,
    baseUrl: config.baseUrl ?? baseModel.baseUrl,
    headers: config.headers ?? baseModel.headers,
  }

  const apiKey = config.apiKey?.trim()

  const thinkingLevel =
    config.thinkingLevel ?? (model.reasoning ? "medium" : "off")

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      thinkingLevel,
      tools,
      messages: options.contextMessages ?? [],
    },
    getApiKey: apiKey
      ? (provider) => (provider === config.provider ? apiKey : undefined)
      : undefined,
  })
  if (options.sessionId) {
    agent.sessionId = options.sessionId
  }

  if (options.onEvent) {
    agent.subscribe(options.onEvent)
  }

  const abortSignal = options.abortSignal
  const abortHandler = () => agent.abort()
  if (abortSignal) {
    if (abortSignal.aborted) {
      abortHandler()
    } else {
      abortSignal.addEventListener("abort", abortHandler)
    }
  }

  try {
    await agent.prompt(expandedPrompt)
    await agent.waitForIdle()
  } finally {
    if (abortSignal) {
      abortSignal.removeEventListener("abort", abortHandler)
    }
    await mcp.close()
  }

  return { state: agent.state, skills }
}

export { loadAgentConfig }
export type { AgentRuntimeConfig } from "./config"
export type { Skill } from "./skills"
export type { AgentEvent, AgentMessage } from "@mariozechner/pi-agent-core"
export { compactMessages, estimateContextTokens } from "./compaction/compactor"
export { McpServerConfigSchema, type McpServerConfig } from "./mcp/config"
export {
  COMPACTION_SUMMARY_PROMPT,
  SUMMARIZATION_SYSTEM_PROMPT,
  UPDATE_COMPACTION_SUMMARY_PROMPT,
} from "./compaction/prompts"
export { buildContextMessages } from "./context"
export { buildSystemPromptUsage }
export type { SystemPromptUsage }
export { createAgentTools }
export { loadProjectContextFiles }
export { loadSkills, type SkillOrigin } from "./skills"
