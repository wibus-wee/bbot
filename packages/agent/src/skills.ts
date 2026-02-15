import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import ignore from "ignore"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

import { parseFrontmatter } from "./utils/frontmatter"

export type SkillOrigin = "package" | "workspace" | "user" | "path"

export type Skill = {
  name: string
  description: string
  filePath: string
  baseDir: string
  origin: SkillOrigin
  disableModelInvocation: boolean
  allowedTools?: string[]
}

export type SkillPromptEntry = {
  name: string
  origin: SkillOrigin
  text: string
}

export type SkillsPromptDetails = {
  text: string
  header: string
  entries: SkillPromptEntry[]
  footer: string
}

export interface SkillFrontmatter {
  name?: string
  description?: string
  allowedTools?: string[] | string
  "disable-model-invocation"?: boolean
  [key: string]: unknown
}

const MAX_NAME_LENGTH = 64
const MAX_DESCRIPTION_LENGTH = 1024
const IGNORE_FILE_NAMES = [".gitignore", ".ignore", ".fdignore"]

type IgnoreMatcher = ReturnType<typeof ignore>

const toPosixPath = (value: string): string => value.split(sep).join("/")

const prefixIgnorePattern = (line: string, prefix: string): string | null => {
  const trimmed = line.trim()
  if (!trimmed) return null
  if (trimmed.startsWith("#") && !trimmed.startsWith("\\#")) return null

  let pattern = line
  let negated = false

  if (pattern.startsWith("!")) {
    negated = true
    pattern = pattern.slice(1)
  } else if (pattern.startsWith("\\!")) {
    pattern = pattern.slice(1)
  }

  if (pattern.startsWith("/")) {
    pattern = pattern.slice(1)
  }

  const prefixed = prefix ? `${prefix}${pattern}` : pattern
  return negated ? `!${prefixed}` : prefixed
}

const addIgnoreRules = (ig: IgnoreMatcher, dir: string, rootDir: string): void => {
  const relativeDir = relative(rootDir, dir)
  const prefix = relativeDir ? `${toPosixPath(relativeDir)}/` : ""

  for (const filename of IGNORE_FILE_NAMES) {
    const ignorePath = join(dir, filename)
    if (!existsSync(ignorePath)) continue
    try {
      const content = readFileSync(ignorePath, "utf-8")
      const patterns = content
        .split(/\r?\n/)
        .map((line) => prefixIgnorePattern(line, prefix))
        .filter((line): line is string => Boolean(line))
      if (patterns.length > 0) {
        ig.add(patterns)
      }
    } catch {}
  }
}

const validateName = (name: string, parentDirName: string): boolean => {
  if (name.length > MAX_NAME_LENGTH) return false
  if (!/^[a-z0-9-]+$/.test(name)) return false
  if (name.startsWith("-") || name.endsWith("-")) return false
  if (name.includes("--")) return false
  if (name !== parentDirName) return false
  return true
}

const validateDescription = (description?: string): boolean => {
  if (!description || description.trim() === "") return false
  if (description.length > MAX_DESCRIPTION_LENGTH) return false
  return true
}

const normalizeAllowedTools = (value?: string[] | string): string[] | undefined => {
  if (!value) return undefined
  if (Array.isArray(value)) {
    return value.map((item) => item.trim()).filter(Boolean)
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

export interface LoadSkillsFromDirOptions {
  dir: string
  source: SkillOrigin
}

export const loadSkillsFromDir = (options: LoadSkillsFromDirOptions): Skill[] => {
  const { dir, source } = options
  return loadSkillsFromDirInternal(dir, source, true)
}

const loadSkillsFromDirInternal = (
  dir: string,
  source: SkillOrigin,
  includeRootFiles: boolean,
  ignoreMatcher?: IgnoreMatcher,
  rootDir?: string,
): Skill[] => {
  const skills: Skill[] = []
  if (!existsSync(dir)) return skills

  const root = rootDir ?? dir
  const ig = ignoreMatcher ?? ignore()
  addIgnoreRules(ig, dir, root)

  try {
    const entries = readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue
      if (entry.name === "node_modules") continue

      const fullPath = join(dir, entry.name)

      let isDirectory = entry.isDirectory()
      let isFile = entry.isFile()
      if (entry.isSymbolicLink()) {
        try {
          const stats = statSync(fullPath)
          isDirectory = stats.isDirectory()
          isFile = stats.isFile()
        } catch {
          continue
        }
      }

      const relPath = toPosixPath(relative(root, fullPath))
      const ignorePath = isDirectory ? `${relPath}/` : relPath
      if (ig.ignores(ignorePath)) continue

      if (isDirectory) {
        skills.push(
          ...loadSkillsFromDirInternal(fullPath, source, false, ig, root),
        )
        continue
      }

      if (!isFile) continue

      const isRootMd = includeRootFiles && entry.name.endsWith(".md")
      const isSkillMd = !includeRootFiles && entry.name === "SKILL.md"
      if (!isRootMd && !isSkillMd) continue

      const skill = loadSkillFromFile(fullPath, source)
      if (skill) {
        skills.push(skill)
      }
    }
  } catch {}

  return skills
}

const loadSkillFromFile = (filePath: string, source: SkillOrigin): Skill | null => {
  try {
    const rawContent = readFileSync(filePath, "utf-8")
    const { frontmatter } = parseFrontmatter<SkillFrontmatter>(rawContent)
    const skillDir = dirname(filePath)

    if (!validateDescription(frontmatter.description)) {
      return null
    }

    const parentDirName = basename(skillDir)
    const name = frontmatter.name || parentDirName
    if (!name) {
      return null
    }
    if (!validateName(name, parentDirName)) {
      return null
    }

    return {
      name,
      description: frontmatter.description ?? "",
      filePath,
      baseDir: skillDir,
      origin: source,
      disableModelInvocation: frontmatter["disable-model-invocation"] === true,
      allowedTools: normalizeAllowedTools(frontmatter.allowedTools),
    }
  } catch {
    return null
  }
}

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")

export const formatSkillsForPrompt = (skills: Skill[]): string => {
  return buildSkillsPromptDetails(skills).text
}

export const buildSkillsPromptDetails = (skills: Skill[]): SkillsPromptDetails => {
  const visibleSkills = skills.filter((skill) => !skill.disableModelInvocation)
  if (visibleSkills.length === 0) {
    return { text: "", header: "", entries: [], footer: "" }
  }

  const headerLines = [
    "\n\nThe following skills provide specialized instructions for specific tasks.",
    "Use the read tool to load a skill's file when the task matches its description.",
    "When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
    "",
    "<available_skills>",
  ]

  const entries = visibleSkills.map((skill) => {
    const entryLines = [
      "  <skill>",
      `    <name>${escapeXml(skill.name)}</name>`,
      `    <description>${escapeXml(skill.description)}</description>`,
      `    <location>${escapeXml(skill.filePath)}</location>`,
      "  </skill>",
    ]
    return {
      name: skill.name,
      origin: skill.origin,
      text: entryLines.join("\n"),
      lines: entryLines,
    }
  })

  const footerLine = "</available_skills>"

  const lines = [...headerLines]
  for (const entry of entries) {
    lines.push(...entry.lines)
  }
  lines.push(footerLine)

  return {
    text: lines.join("\n"),
    header: headerLines.join("\n"),
    entries: entries.map(({ name, origin, text }) => ({ name, origin, text })),
    footer: footerLine,
  }
}

export interface LoadSkillsOptions {
  workspaceRoot?: string
  skillPaths?: string[]
  includeDefaults?: boolean
}

const normalizePath = (input: string): string => {
  const trimmed = input.trim()
  if (trimmed === "~") return homedir()
  if (trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2))
  if (trimmed.startsWith("~")) return join(homedir(), trimmed.slice(1))
  return trimmed
}

const resolveSkillPath = (value: string, cwd: string): string => {
  const normalized = normalizePath(value)
  return isAbsolute(normalized) ? normalized : resolve(cwd, normalized)
}

export const loadSkills = (options: LoadSkillsOptions = {}): Skill[] => {
  const { workspaceRoot = process.cwd(), skillPaths = [], includeDefaults = true } = options

  const skillMap = new Map<string, Skill>()
  const realPathSet = new Set<string>()

  const addSkills = (items: Skill[]) => {
    for (const skill of items) {
      let realPath: string
      try {
        realPath = realpathSync(skill.filePath)
      } catch {
        realPath = skill.filePath
      }

      if (realPathSet.has(realPath)) continue

      if (!skillMap.has(skill.name)) {
        skillMap.set(skill.name, skill)
        realPathSet.add(realPath)
      }
    }
  }

  if (includeDefaults) {
    addSkills(
      loadSkillsFromDirInternal(
        resolve(workspaceRoot, "packages/agent/skills"),
        "package",
        true,
      ),
    )
    addSkills(
      loadSkillsFromDirInternal(
        resolve(workspaceRoot, ".bbot/skills"),
        "workspace",
        true,
      ),
    )
    addSkills(
      loadSkillsFromDirInternal(
        resolve(workspaceRoot, ".agents/skills"),
        "workspace",
        true,
      ),
    )
    addSkills(
      loadSkillsFromDirInternal(resolve(homedir(), ".bbot/skills"), "user", true),
    )
    addSkills(
      loadSkillsFromDirInternal(resolve(homedir(), ".agents/skills"), "user", true),
    )
  }

  for (const rawPath of skillPaths) {
    const resolvedPath = resolveSkillPath(rawPath, workspaceRoot)
    if (!existsSync(resolvedPath)) {
      continue
    }

    try {
      const stats = statSync(resolvedPath)
      const source: SkillOrigin = "path"
      if (stats.isDirectory()) {
        addSkills(loadSkillsFromDirInternal(resolvedPath, source, true))
      } else if (stats.isFile() && resolvedPath.endsWith(".md")) {
        const skill = loadSkillFromFile(resolvedPath, source)
        if (skill) {
          addSkills([skill])
        }
      }
    } catch {}
  }

  return Array.from(skillMap.values())
}
