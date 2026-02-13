import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, parse, resolve } from "node:path"

export type ContextFile = { path: string; content: string }

const CONTEXT_FILE_NAMES = ["AGENTS.md", "CLAUDE.md"]

const loadContextFileFromDir = (dir: string): ContextFile | null => {
  for (const filename of CONTEXT_FILE_NAMES) {
    const filePath = join(dir, filename)
    if (!existsSync(filePath)) continue
    try {
      return { path: filePath, content: readFileSync(filePath, "utf-8") }
    } catch {
      return null
    }
  }
  return null
}

export type LoadProjectContextOptions = {
  cwd?: string
  agentDir?: string
}

export const loadProjectContextFiles = (
  options: LoadProjectContextOptions = {},
): ContextFile[] => {
  const resolvedCwd = options.cwd ?? process.cwd()
  const resolvedAgentDir = options.agentDir ?? resolve(homedir(), ".agents")

  const contextFiles: ContextFile[] = []
  const seen = new Set<string>()

  const globalContext = loadContextFileFromDir(resolvedAgentDir)
  if (globalContext) {
    contextFiles.push(globalContext)
    seen.add(globalContext.path)
  }

  const ancestorContextFiles: ContextFile[] = []
  let currentDir = resolvedCwd
  const root = parse(resolvedCwd).root || resolve("/")

  while (true) {
    const contextFile = loadContextFileFromDir(currentDir)
    if (contextFile && !seen.has(contextFile.path)) {
      ancestorContextFiles.unshift(contextFile)
      seen.add(contextFile.path)
    }

    if (currentDir === root) break
    const parentDir = resolve(currentDir, "..")
    if (parentDir === currentDir) break
    currentDir = parentDir
  }

  contextFiles.push(...ancestorContextFiles)
  return contextFiles
}
