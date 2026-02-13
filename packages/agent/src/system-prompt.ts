import { formatSkillsForPrompt, type Skill } from "./skills"

export const DEFAULT_SYSTEM_PROMPT = [
  "You are a reliable coding agent.",
  "Prefer deterministic tool use over speculation.",
  "Keep outputs concise and actionable.",
].join("\n")

export const buildSystemPrompt = (options: {
  basePrompt: string
  workspaceRoot: string
  skills: Skill[]
}) => {
  const lines: string[] = []
  const base = options.basePrompt.trim() || DEFAULT_SYSTEM_PROMPT
  lines.push(base)
  lines.push("")
  lines.push(`Workspace root: ${options.workspaceRoot}`)

  const skillsBlock = formatSkillsForPrompt(options.skills)
  if (skillsBlock) {
    lines.push(skillsBlock)
  }

  return lines.join("\n")
}
