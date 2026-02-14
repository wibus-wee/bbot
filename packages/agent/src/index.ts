import { Agent } from "@mariozechner/pi-agent-core"
import { getModel, KnownProvider } from "@mariozechner/pi-ai"

import type { AgentEvent, AgentMessage, AgentState } from "@mariozechner/pi-agent-core"

import { loadAgentConfig, type AgentRuntimeConfig } from "./config"
import { compactMessages } from "./compaction/compactor"
import { loadProjectContextFiles } from "./resource-loader"
import { expandSkillCommand } from "./skill-command"
import { loadSkills, type Skill } from "./skills"
import { buildSystemPrompt } from "./system-prompt"
import { createAgentTools } from "./tools"
import { createMcpTools } from "./mcp/tools"
import { runAcpAgent } from "./acp"

export type RunAgentOptions = {
  prompt: string
  workspaceRoot: string
  sessionId?: string
  config?: AgentRuntimeConfig
  onEvent?: (event: AgentEvent) => void
  contextMessages?: AgentMessage[]
  onCompaction?: (summary: string) => void | Promise<void>
  abortSignal?: AbortSignal
}

export type RunAgentResult = {
  state: AgentState
  skills: Skill[]
}

export const runAgent = async (options: RunAgentOptions): Promise<RunAgentResult> => {
  const config = options.config ?? loadAgentConfig()
  const skills = loadSkills({ workspaceRoot: options.workspaceRoot })
  const expandedPrompt = expandSkillCommand(options.prompt, skills)

  if (config.provider === "acp") {
    const acpConfig = config.acp
    if (!acpConfig?.command) {
      throw new Error(
        "ACP_COMMAND is required when AGENT_PROVIDER=acp",
      )
    }

    const { errorMessage } = await runAcpAgent({
      prompt: expandedPrompt,
      contextMessages: options.contextMessages,
      onEvent: options.onEvent,
      workspaceRoot: options.workspaceRoot,
      abortSignal: options.abortSignal,
      config: {
        command: acpConfig.command,
        args: acpConfig.args,
      },
    })

    return {
      state: { error: errorMessage ?? "" } as AgentState,
      skills,
    }
  }

  const baseTools = createAgentTools({
    workspaceRoot: options.workspaceRoot,
  })
  const mcp = await createMcpTools({
    servers: config.mcpServers,
    logger: (message) => {
      console.error(message)
    },
  })
  const tools = [...baseTools, ...mcp.tools]
  const contextFiles = loadProjectContextFiles({ cwd: options.workspaceRoot })
  const systemPrompt = buildSystemPrompt({
    customPrompt: config.systemPrompt?.trim() ? config.systemPrompt : undefined,
    promptProfile: config.promptProfile,
    appendSystemPrompt: config.appendSystemPrompt,
    cwd: options.workspaceRoot,
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
    })),
    contextFiles,
    skills,
  })

  // @ts-expect-error - We need to cast here because the config is loaded at runtime and we can't guarantee that it will always match the expected types. We should add validation to ensure that the config is correct.
  const baseModel = getModel(config.provider as KnownProvider, config.model)
  const model = config.baseUrl ? { ...baseModel, baseUrl: config.baseUrl } : baseModel

  const agentRef: { current: Agent | null } = { current: null }
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
    transformContext: async (messages) => {
      const activeModel = agentRef.current?.state.model ?? model
      try {
        const result = await compactMessages({
          messages,
          model: activeModel,
          settings: config.compaction,
        })
        if (result.didCompact && result.summary) {
          try {
            await options.onCompaction?.(result.summary)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            console.error(`[agent] failed to persist summary: ${message}`)
          }
        }
        return result.messages
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[agent] compaction failed: ${message}`)
        return messages
      }
    },
  })
  agentRef.current = agent

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
export { compactMessages } from "./compaction/compactor"
export {
  COMPACTION_SUMMARY_PROMPT,
  SUMMARIZATION_SYSTEM_PROMPT,
  UPDATE_COMPACTION_SUMMARY_PROMPT,
} from "./compaction/prompts"
export { buildContextMessages } from "./context"
