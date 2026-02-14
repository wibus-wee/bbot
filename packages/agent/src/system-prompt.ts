import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  buildSkillsPromptDetails,
  formatSkillsForPrompt,
  type Skill,
  type SkillOrigin,
} from "./skills"

type ToolDescriptor = {
  name: string
  description?: string
}

declare global {
  var __SYSTEM_PROMPT__: string | undefined
  var __SYSTEM_PROMPT_FREE__: string | undefined
}

export type PromptProfile = "coding" | "free"

const PROMPT_PATHS: Record<PromptProfile, string> = {
  coding: "gpt-5.2-codex-prompt.md",
  free: "gpt-5.2-codex-free-prompt.md",
}

const resolvePrompt = (profile: PromptProfile = "coding"): string => {
  const injectedPrompt =
    profile === "free" ? globalThis.__SYSTEM_PROMPT_FREE__ : globalThis.__SYSTEM_PROMPT__
  if (typeof injectedPrompt === "string" && injectedPrompt.trim()) {
    return injectedPrompt.trim()
  }

  return readFileSync(join(__dirname, "prompts", PROMPT_PATHS[profile]), "utf-8").trim()
}

export const DEFAULT_SYSTEM_PROMPT = resolvePrompt("coding")

const TOOL_DESCRIPTIONS: Record<string, string> = {
  read: "Read file contents.",
  write: "Create or overwrite files.",
  edit: "Apply an apply_patch formatted patch to files.",
  grep: "Search file contents with ripgrep.",
  find: "Find files by glob pattern.",
  ls: "List directory contents.",
  bash: "Run a command in the workspace. Use `command` as the executable path/name and `args` as a string array; no shell parsing. For pipes/redirection, run `/bin/bash` with `args: [\"-lc\", \"<cmd>\"]`.",
}

export type BuildSystemPromptOptions = {
  customPrompt?: string
  appendSystemPrompt?: string
  cwd?: string
  tools?: ToolDescriptor[]
  contextFiles?: Array<{ path: string; content: string }>
  skills?: Skill[]
  now?: Date
  promptProfile?: PromptProfile
}

export type SystemPromptUsage = {
  prompt: string
  totalTokens: number
  isCustomPrompt: boolean
  promptProfile?: PromptProfile
  parts: {
    basePromptTokens: number
    toolsTokens: number
    guidelinesTokens: number
    appendPromptTokens: number
    contextFilesTokens: number
    skillsTokens: number
    runtimeTokens: number
  }
  contextFiles: Array<{ path: string; tokens: number }>
  skills: Array<{ name: string; origin: SkillOrigin; tokens: number }>
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
  const hasGrep = toolNames.has("grep")
  const hasFind = toolNames.has("find")
  const hasLs = toolNames.has("ls")
  const hasBash = toolNames.has("bash")

  if ((hasGrep || hasFind || hasLs) && hasBash) {
    guidelines.push(
      "Prefer grep/find/ls over bash for search and file discovery (faster, respects ignore rules).",
    )
  } else if (hasBash && !(hasGrep || hasFind || hasLs)) {
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

  if (hasGrep) {
    guidelines.push("Use grep to search file contents.")
  }

  if (hasFind) {
    guidelines.push("Use find to locate files by name or glob.")
  }

  if (hasLs) {
    guidelines.push("Use ls to inspect directory contents.")
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

type ContextSectionDetails = {
  section: string
  header: string
  entries: Array<{ path: string; text: string }>
}

const buildContextSectionDetails = (
  contextFiles: Array<{ path: string; content: string }>,
): ContextSectionDetails => {
  if (contextFiles.length === 0) {
    return { section: "", header: "", entries: [] }
  }

  const hasSoulFile = contextFiles.some((file) => {
    const normalizedPath = file.path.trim().replace(/\\/g, "/")
    const baseName = normalizedPath.split("/").pop() ?? normalizedPath
    return baseName.toLowerCase() === "soul.md"
  })

  const headerParts = [
    "\n\n# Project Context\n\n",
    "Project-specific instructions and guidelines:\n\n",
  ]
  if (hasSoulFile) {
    headerParts.push(
      "If SOUL.md is present, embody its persona and tone. Avoid stiff, generic replies; follow its guidance unless higher-priority instructions override it.\n\n",
    )
  }

  const entries = contextFiles.map((contextFile) => {
    const text = `## ${contextFile.path}\n\n${contextFile.content}\n\n`
    return { path: contextFile.path, text }
  })

  const header = headerParts.join("")
  const section = header + entries.map((entry) => entry.text).join("")

  return { section, header, entries }
}

const appendContextAndSkills = (
  prompt: string,
  options: BuildSystemPromptOptions,
  hasReadTool: boolean,
): string => {
  let updated = prompt
  const contextFiles = options.contextFiles ?? []
  const skills = options.skills ?? []

  const contextSection = buildContextSectionDetails(contextFiles).section
  if (contextSection) {
    updated += contextSection
  }

  if (hasReadTool && skills.length > 0) {
    updated += formatSkillsForPrompt(skills)
  }

  return updated
}

const estimatePromptTokens = (text: string): number => {
  if (!text) return 0
  return Math.ceil(text.length / 4)
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
  const basePrompt = resolvePrompt(options.promptProfile ?? "coding")

  let prompt = `${basePrompt}\n\nAvailable tools:\n${toolsList}\n\nGuidelines:\n${guidelines}`

  if (appendSection) {
    prompt += appendSection
  }

  prompt = appendContextAndSkills(prompt, options, hasReadTool)
  prompt += `\nCurrent date and time: ${dateTime}`
  prompt += `\nCurrent working directory: ${resolvedCwd}`

  return prompt
}

export const buildSystemPromptUsage = (
  options: BuildSystemPromptOptions = {},
): SystemPromptUsage => {
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

  const contextFiles = options.contextFiles ?? []
  const contextDetails = buildContextSectionDetails(contextFiles)

  const skills = options.skills ?? []
  const skillsDetails = hasReadTool ? buildSkillsPromptDetails(skills) : null
  const skillsSection = skillsDetails?.text ?? ""

  const runtimeSection =
    `\nCurrent date and time: ${dateTime}` +
    `\nCurrent working directory: ${resolvedCwd}`

  if (options.customPrompt && options.customPrompt.trim()) {
    const basePrompt = options.customPrompt.trim()
    let prompt = basePrompt
    if (appendSection) {
      prompt += appendSection
    }
    prompt += contextDetails.section
    prompt += skillsSection
    prompt += runtimeSection

    const contextFileTokens = contextDetails.entries.map((entry) => ({
      path: entry.path,
      tokens: estimatePromptTokens(entry.text),
    }))

    const skillTokens = skillsDetails?.entries.map((entry) => ({
      name: entry.name,
      origin: entry.origin,
      tokens: estimatePromptTokens(entry.text),
    })) ?? []

    return {
      prompt,
      totalTokens: estimatePromptTokens(prompt),
      isCustomPrompt: true,
      promptProfile: options.promptProfile,
      parts: {
        basePromptTokens: estimatePromptTokens(basePrompt),
        toolsTokens: 0,
        guidelinesTokens: 0,
        appendPromptTokens: estimatePromptTokens(appendSection),
        contextFilesTokens: estimatePromptTokens(contextDetails.section),
        skillsTokens: estimatePromptTokens(skillsSection),
        runtimeTokens: estimatePromptTokens(runtimeSection),
      },
      contextFiles: contextFileTokens,
      skills: skillTokens,
    }
  }

  const basePrompt = resolvePrompt(options.promptProfile ?? "coding")
  const toolsList = formatTools(tools)
  const guidelines = buildGuidelines(toolNames)
  const toolsSection = `\n\nAvailable tools:\n${toolsList}`
  const guidelinesSection = `\n\nGuidelines:\n${guidelines}`

  let prompt = `${basePrompt}${toolsSection}${guidelinesSection}`
  if (appendSection) {
    prompt += appendSection
  }
  prompt += contextDetails.section
  prompt += skillsSection
  prompt += runtimeSection

  const contextFileTokens = contextDetails.entries.map((entry) => ({
    path: entry.path,
    tokens: estimatePromptTokens(entry.text),
  }))

  const skillTokens = skillsDetails?.entries.map((entry) => ({
    name: entry.name,
    origin: entry.origin,
    tokens: estimatePromptTokens(entry.text),
  })) ?? []

  return {
    prompt,
    totalTokens: estimatePromptTokens(prompt),
    isCustomPrompt: false,
    promptProfile: options.promptProfile,
    parts: {
      basePromptTokens: estimatePromptTokens(basePrompt),
      toolsTokens: estimatePromptTokens(toolsSection),
      guidelinesTokens: estimatePromptTokens(guidelinesSection),
      appendPromptTokens: estimatePromptTokens(appendSection),
      contextFilesTokens: estimatePromptTokens(contextDetails.section),
      skillsTokens: estimatePromptTokens(skillsSection),
      runtimeTokens: estimatePromptTokens(runtimeSection),
    },
    contextFiles: contextFileTokens,
    skills: skillTokens,
  }
}
