import { formatSkillsForPrompt, type Skill } from "./skills"

type ToolDescriptor = {
  name: string
  description?: string
}

export const DEFAULT_SYSTEM_PROMPT = [
  "You are a reliable coding agent.",
  "Prefer deterministic tool use over speculation.",
  "Keep outputs concise and actionable.",
].join("\n")

const TOOL_DESCRIPTIONS: Record<string, string> = {
  read: "Read file contents.",
  write: "Create or overwrite files.",
  edit: "Apply a unified diff patch to a file.",
  search: "Search the workspace with ripgrep.",
  bash: "Run a command in the workspace.",
}

export type BuildSystemPromptOptions = {
  customPrompt?: string
  appendSystemPrompt?: string
  cwd?: string
  tools?: ToolDescriptor[]
  contextFiles?: Array<{ path: string; content: string }>
  skills?: Skill[]
  now?: Date
}

const formatTools = (tools: ToolDescriptor[]): string => {
  if (tools.length === 0) return "(none)"
  return tools
    .map((tool) => {
      const fallback = TOOL_DESCRIPTIONS[tool.name] ?? "No description available."
      return `- ${tool.name}: ${tool.description ?? fallback}`
    })
    .join("\n")
}

const buildGuidelines = (toolNames: Set<string>): string => {
  const guidelines: string[] = []

  const hasRead = toolNames.has("read")
  const hasWrite = toolNames.has("write")
  const hasEdit = toolNames.has("edit")
  const hasSearch = toolNames.has("search")
  const hasBash = toolNames.has("bash")

  if (hasSearch && hasBash) {
    guidelines.push(
      "Prefer the search tool over bash for file discovery (faster, respects ignore rules).",
    )
  } else if (hasBash && !hasSearch) {
    guidelines.push("Use bash for file operations like ls, rg, find.")
  }

  if (hasRead && hasEdit) {
    guidelines.push(
      "Use read to examine files before editing. Do not use bash to read file contents.",
    )
  }

  if (hasEdit) {
    guidelines.push("Use edit for precise changes (patch must match exactly).")
  }

  if (hasWrite) {
    guidelines.push("Use write only for new files or complete rewrites.")
  }

  if (hasEdit || hasWrite) {
    guidelines.push(
      "When summarizing your actions, output plain text directly; do NOT use bash to show what you did.",
    )
  }

  guidelines.push("Be concise in your responses.")
  guidelines.push("Show file paths clearly when working with files.")

  return guidelines.map((line) => `- ${line}`).join("\n")
}

const appendContextAndSkills = (
  prompt: string,
  options: BuildSystemPromptOptions,
  hasReadTool: boolean,
): string => {
  let updated = prompt
  const contextFiles = options.contextFiles ?? []
  const skills = options.skills ?? []

  if (contextFiles.length > 0) {
    updated += "\n\n# Project Context\n\n"
    updated += "Project-specific instructions and guidelines:\n\n"
    for (const { path, content } of contextFiles) {
      updated += `## ${path}\n\n${content}\n\n`
    }
  }

  if (hasReadTool && skills.length > 0) {
    updated += formatSkillsForPrompt(skills)
  }

  return updated
}

export const buildSystemPrompt = (options: BuildSystemPromptOptions = {}): string => {
  const tools = options.tools ?? []
  const toolNames = new Set(tools.map((tool) => tool.name))
  const hasReadTool = toolNames.has("read") || tools.length === 0
  const resolvedCwd = options.cwd ?? process.cwd()
  const now = options.now ?? new Date()
  const dateTime = now.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  })

  const appendSection = options.appendSystemPrompt
    ? `\n\n${options.appendSystemPrompt}`
    : ""

  if (options.customPrompt && options.customPrompt.trim()) {
    let prompt = options.customPrompt.trim()
    if (appendSection) {
      prompt += appendSection
    }
    prompt = appendContextAndSkills(prompt, options, hasReadTool)
    prompt += `\nCurrent date and time: ${dateTime}`
    prompt += `\nCurrent working directory: ${resolvedCwd}`
    return prompt
  }

  const toolsList = formatTools(tools)
  const guidelines = buildGuidelines(toolNames)

  let prompt = `${DEFAULT_SYSTEM_PROMPT}\n\nAvailable tools:\n${toolsList}\n\nGuidelines:\n${guidelines}`

  if (appendSection) {
    prompt += appendSection
  }

  prompt = appendContextAndSkills(prompt, options, hasReadTool)
  prompt += `\nCurrent date and time: ${dateTime}`
  prompt += `\nCurrent working directory: ${resolvedCwd}`

  return prompt
}
