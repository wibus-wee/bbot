import { readFileSync } from "node:fs"

import type { Skill } from "./skills"
import { stripFrontmatter } from "./utils/frontmatter"

export const expandSkillCommand = (text: string, skills: Skill[]): string => {
  if (!text.startsWith("/skill:")) return text

  const spaceIndex = text.indexOf(" ")
  const skillName = spaceIndex === -1 ? text.slice(7) : text.slice(7, spaceIndex)
  const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim()

  const skill = skills.find((candidate) => candidate.name === skillName)
  if (!skill) return text

  try {
    const content = readFileSync(skill.filePath, "utf-8")
    const body = stripFrontmatter(content).trim()
    const skillBlock = [
      `<skill name="${skill.name}" location="${skill.filePath}">`,
      `References are relative to ${skill.baseDir}.`,
      "",
      body,
      "</skill>",
    ].join("\n")
    return args ? `${skillBlock}\n\n${args}` : skillBlock
  } catch {
    return text
  }
}
