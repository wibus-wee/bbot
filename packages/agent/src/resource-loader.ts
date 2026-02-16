import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, parse, resolve } from "node:path"

export type ContextFile = { path: string; content: string }

const CONTEXT_FILE_NAMES = [
  "SOUL.md",
  "USER.md",
  "IDENTITY.md",
  "AGENTS.md",
  "MEMORY.md",
]

const loadContextFilesFromDir = (dir: string): ContextFile[] => {
  const results: ContextFile[] = []
  for (const filename of CONTEXT_FILE_NAMES) {
    const filePath = join(dir, filename)
    if (!existsSync(filePath)) continue
    try {
      results.push({ path: filePath, content: readFileSync(filePath, "utf-8") })
    } catch {
      // Ignore unreadable context files and continue scanning.
    }
  }
  return results
}

export type LoadProjectContextOptions = {
  cwd?: string
  agentDir?: string
  agentDirs?: string[]
}

const resolveLocalContextDirs = (options: LoadProjectContextOptions): string[] => {
  if (options.agentDirs && options.agentDirs.length > 0) {
    return options.agentDirs.map((dir) => resolve(dir))
  }
  if (options.agentDir) {
    return [resolve(options.agentDir)]
  }
  return [resolve(homedir(), ".bbot"), resolve(homedir(), ".agents")]
}

export const loadProjectContextFiles = (
  options: LoadProjectContextOptions = {},
): ContextFile[] => {
  const resolvedCwd = options.cwd ?? process.cwd()
  const resolvedAgentDirs = resolveLocalContextDirs(options)

  const contextFiles: ContextFile[] = []
  const seen = new Set<string>()

  for (const resolvedAgentDir of resolvedAgentDirs) {
    const globalContexts = loadContextFilesFromDir(resolvedAgentDir)
    for (const contextFile of globalContexts) {
      if (seen.has(contextFile.path)) continue
      contextFiles.push(contextFile)
      seen.add(contextFile.path)
    }
  }

  const ancestorContextFiles: ContextFile[] = []
  let currentDir = resolvedCwd
  const root = parse(resolvedCwd).root || resolve("/")

  while (true) {
    const contextFilesInDir = loadContextFilesFromDir(currentDir)
    if (contextFilesInDir.length > 0) {
      for (let index = contextFilesInDir.length - 1; index >= 0; index -= 1) {
        const contextFile = contextFilesInDir[index]
        if (!contextFile) continue
        if (seen.has(contextFile.path)) continue
        ancestorContextFiles.unshift(contextFile)
        seen.add(contextFile.path)
      }
    }

    if (currentDir === root) break
    const parentDir = resolve(currentDir, "..")
    if (parentDir === currentDir) break
    currentDir = parentDir
  }

  contextFiles.push(...ancestorContextFiles)
  return contextFiles
}
