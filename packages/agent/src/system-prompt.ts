import { readFileSync } from "node:fs"
import { hostname, platform } from "node:os"
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

const SAFETY_GUIDELINES = [
  "Do not exfiltrate private data.",
  "Do not run destructive commands without asking.",
  "Do not bypass oversight or approval mechanisms.",
  "Prefer `trash` over `rm` (recoverable beats gone forever).",
  "When in doubt, ask before acting externally.",
]

const BOOTSTRAP_FILE_ORDER = [
  "AGENTS.md",
  "SOUL.md",
  "TOOLS.md",
  "IDENTITY.md",
  "USER.md",
  "HEARTBEAT.md",
  "BOOTSTRAP.md",
  "MEMORY.md",
]

export type BuildSystemPromptOptions = {
  customPrompt?: string
  appendSystemPrompt?: string
  cwd?: string
  tools?: ToolDescriptor[]
  contextFiles?: Array<{ path: string; content: string }>
  skills?: Skill[]
  now?: Date
  promptProfile?: PromptProfile
  modelName?: string
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
    safetyTokens: number
    appendPromptTokens: number
    contextFilesTokens: number
    skillsTokens: number
    workspaceTokens: number
    dateTimeTokens: number
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
      return `- **${tool.name}**: ${tool.description ?? fallback}`
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

const extractBaseName = (filePath: string): string => {
  const normalizedPath = filePath.trim().replace(/\\/g, "/")
  return normalizedPath.split("/").pop() ?? normalizedPath
}

const buildContextSectionDetails = (
  contextFiles: Array<{ path: string; content: string }>,
): ContextSectionDetails => {
  if (contextFiles.length === 0) {
    return { section: "", header: "", entries: [] }
  }

  const hasSoulFile = contextFiles.some(
    (file) => extractBaseName(file.path).toLowerCase() === "soul.md",
  )

  const orderMap = new Map(
    BOOTSTRAP_FILE_ORDER.map((name, index) => [name.toLowerCase(), index]),
  )

  const orderedFiles = contextFiles
    .map((file, index) => {
      const baseName = extractBaseName(file.path).toLowerCase()
      const order = orderMap.get(baseName) ?? BOOTSTRAP_FILE_ORDER.length + index
      return { file, index, order }
    })
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map((entry) => entry.file)

  const headerParts = [
    "## Project Context",
    "",
    "Project-specific instructions and guidelines:",
    "",
  ]
  if (hasSoulFile) {
    headerParts.push(
      "If SOUL.md is present, embody its persona and tone. Avoid stiff, generic replies; follow its guidance unless higher-priority instructions override it.",
      "",
    )
  }

  const entries = orderedFiles.map((contextFile) => {
    const text = `## ${contextFile.path}\n\n${contextFile.content}\n`
    return { path: contextFile.path, text }
  })

  const bootstrapSet = new Set(
    BOOTSTRAP_FILE_ORDER.map((name) => name.toLowerCase()),
  )
  const bootstrapEntries = entries.filter((entry) => {
    const baseName = extractBaseName(entry.path).toLowerCase()
    return bootstrapSet.has(baseName)
  })
  const extraEntries = entries.filter((entry) => {
    const baseName = extractBaseName(entry.path).toLowerCase()
    return !bootstrapSet.has(baseName)
  })

  const header = headerParts.join("\n")
  const sectionParts = [header]
  if (bootstrapEntries.length > 0) {
    sectionParts.push("### Bootstrap Files", "")
    sectionParts.push(bootstrapEntries.map((entry) => entry.text).join("\n"))
  }
  if (extraEntries.length > 0) {
    sectionParts.push("### Additional Context", "")
    sectionParts.push(extraEntries.map((entry) => entry.text).join("\n"))
  }
  const section = sectionParts.filter((part) => part && part.trim()).join("\n")

  return { section, header, entries }
}

const estimatePromptTokens = (text: string): number => {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

const buildToolsSection = (tools: ToolDescriptor[]): string => {
  const toolsList = formatTools(tools)
  return [
    "## Tools",
    "",
    "You have access to the following tools:",
    "",
    toolsList,
  ].join("\n")
}

const buildGuidelinesSection = (toolNames: Set<string>): string => {
  const guidelines = buildGuidelines(toolNames)
  return ["## Tooling Guidelines", "", guidelines].join("\n")
}

const buildSafetySection = (): string => {
  return [
    "## Safety",
    "",
    SAFETY_GUIDELINES.map((line) => `- ${line}`).join("\n"),
  ].join("\n")
}

const buildSkillsSection = (skills: Skill[], hasReadTool: boolean): string => {
  if (!hasReadTool || skills.length === 0) {
    return ""
  }
  return formatSkillsForPrompt(skills)
}

const buildWorkspaceSection = (cwd: string): string => {
  return ["## Workspace", "", `Working directory: \`${cwd}\``].join("\n")
}

const getTimeZoneName = (now: Date): string => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(now)
  return parts.find((part) => part.type === "timeZoneName")?.value ?? "unknown"
}

const buildDateTimeSection = (now: Date): string => {
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
  const tz = getTimeZoneName(now)
  return ["## Current Date & Time", "", `Local time: ${dateTime}`, `Timezone: ${tz}`].join("\n")
}

const buildRuntimeSection = (modelName?: string): string => {
  const host = hostname()
  const model = modelName?.trim() ? modelName.trim() : "unknown"
  return ["## Runtime", "", `Host: ${host} | OS: ${platform()} | Model: ${model}`].join("\n")
}

const joinSections = (sections: string[]): string =>
  sections.filter((section) => section && section.trim()).join("\n\n")

export const buildSystemPrompt = (options: BuildSystemPromptOptions = {}): string => {
  const tools = options.tools ?? []
  const toolNames = new Set(tools.map((tool) => tool.name))
  const hasReadTool = toolNames.has("read") || tools.length === 0
  const resolvedCwd = options.cwd ?? process.cwd()
  const now = options.now ?? new Date()
  const contextFiles = options.contextFiles ?? []
  const skills = options.skills ?? []

  const appendSection = options.appendSystemPrompt
    ? options.appendSystemPrompt.trim()
    : ""

  if (options.customPrompt && options.customPrompt.trim()) {
    const basePrompt = options.customPrompt.trim()
    const sections = [
      basePrompt,
      appendSection,
      buildSkillsSection(skills, hasReadTool),
      buildWorkspaceSection(resolvedCwd),
      buildContextSectionDetails(contextFiles).section,
      buildDateTimeSection(now),
      buildRuntimeSection(options.modelName),
    ]
    return joinSections(sections)
  }

  const basePrompt = resolvePrompt(options.promptProfile ?? "coding")
  const sections = [
    basePrompt,
    appendSection,
    buildToolsSection(tools),
    buildGuidelinesSection(toolNames),
    buildSafetySection(),
    buildSkillsSection(skills, hasReadTool),
    buildWorkspaceSection(resolvedCwd),
    buildContextSectionDetails(contextFiles).section,
    buildDateTimeSection(now),
    buildRuntimeSection(options.modelName),
  ]

  return joinSections(sections)
}

export const buildSystemPromptUsage = (
  options: BuildSystemPromptOptions = {},
): SystemPromptUsage => {
  const tools = options.tools ?? []
  const toolNames = new Set(tools.map((tool) => tool.name))
  const hasReadTool = toolNames.has("read") || tools.length === 0
  const resolvedCwd = options.cwd ?? process.cwd()
  const now = options.now ?? new Date()
  const appendSection = options.appendSystemPrompt
    ? options.appendSystemPrompt.trim()
    : ""

  const contextFiles = options.contextFiles ?? []
  const contextDetails = buildContextSectionDetails(contextFiles)

  const skills = options.skills ?? []
  const skillsDetails = hasReadTool ? buildSkillsPromptDetails(skills) : null
  const skillsSection = skillsDetails?.text ?? ""

  const workspaceSection = buildWorkspaceSection(resolvedCwd)
  const dateTimeSection = buildDateTimeSection(now)
  const runtimeSection = buildRuntimeSection(options.modelName)

  if (options.customPrompt && options.customPrompt.trim()) {
    const basePrompt = options.customPrompt.trim()
    const prompt = joinSections([
      basePrompt,
      appendSection,
      skillsSection,
      workspaceSection,
      contextDetails.section,
      dateTimeSection,
      runtimeSection,
    ])

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
        safetyTokens: 0,
        appendPromptTokens: estimatePromptTokens(appendSection),
        contextFilesTokens: estimatePromptTokens(contextDetails.section),
        skillsTokens: estimatePromptTokens(skillsSection),
        workspaceTokens: estimatePromptTokens(workspaceSection),
        dateTimeTokens: estimatePromptTokens(dateTimeSection),
        runtimeTokens: estimatePromptTokens(runtimeSection),
      },
      contextFiles: contextFileTokens,
      skills: skillTokens,
    }
  }

  const basePrompt = resolvePrompt(options.promptProfile ?? "coding")
  const toolsSection = buildToolsSection(tools)
  const guidelinesSection = buildGuidelinesSection(toolNames)
  const safetySection = buildSafetySection()

  const prompt = joinSections([
    basePrompt,
    appendSection,
    toolsSection,
    guidelinesSection,
    safetySection,
    skillsSection,
    workspaceSection,
    contextDetails.section,
    dateTimeSection,
    runtimeSection,
  ])

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
      safetyTokens: estimatePromptTokens(safetySection),
      appendPromptTokens: estimatePromptTokens(appendSection),
      contextFilesTokens: estimatePromptTokens(contextDetails.section),
      skillsTokens: estimatePromptTokens(skillsSection),
      workspaceTokens: estimatePromptTokens(workspaceSection),
      dateTimeTokens: estimatePromptTokens(dateTimeSection),
      runtimeTokens: estimatePromptTokens(runtimeSection),
    },
    contextFiles: contextFileTokens,
    skills: skillTokens,
  }
}
