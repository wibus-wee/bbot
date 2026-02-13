import { Agent } from "@mariozechner/pi-agent-core"
import { getModel, KnownProvider } from "@mariozechner/pi-ai"

import type { AgentEvent, AgentState } from "@mariozechner/pi-agent-core"

import { loadAgentConfig, type AgentRuntimeConfig } from "./config"
import { loadSkills, type Skill } from "./skills"
import { buildSystemPrompt, DEFAULT_SYSTEM_PROMPT } from "./system-prompt"
import { createAgentTools } from "./tools"

export type RunAgentOptions = {
  prompt: string
  workspaceRoot: string
  sessionId?: string
  config?: AgentRuntimeConfig
  onEvent?: (event: AgentEvent) => void
}

export type RunAgentResult = {
  state: AgentState
  skills: Skill[]
}

export const runAgent = async (options: RunAgentOptions): Promise<RunAgentResult> => {
  const config = options.config ?? loadAgentConfig()
  const skills = loadSkills({ workspaceRoot: options.workspaceRoot })
  const systemPrompt = buildSystemPrompt({
    basePrompt: config.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    workspaceRoot: options.workspaceRoot,
    skills,
  })

  // @ts-expect-error - We need to cast here because the config is loaded at runtime and we can't guarantee that it will always match the expected types. We should add validation to ensure that the config is correct.
  const baseModel = getModel(config.provider as KnownProvider, config.model)
  const model = config.baseUrl ? { ...baseModel, baseUrl: config.baseUrl } : baseModel
  const tools = createAgentTools({
    workspaceRoot: options.workspaceRoot,
  })

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      thinkingLevel: config.thinkingLevel,
      tools,
      messages: [],
    },
  })

  if (options.sessionId) {
    agent.sessionId = options.sessionId
  }

  if (options.onEvent) {
    agent.subscribe(options.onEvent)
  }

  await agent.prompt(options.prompt)
  await agent.waitForIdle()

  return { state: agent.state, skills }
}

export { loadAgentConfig }
export type { AgentRuntimeConfig } from "./config"
export type { Skill } from "./skills"
export type { AgentEvent, AgentMessage } from "@mariozechner/pi-agent-core"
