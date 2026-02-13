import { spawn } from "node:child_process"
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import { dirname, relative, resolve, sep } from "node:path"

import { applyPatch, parsePatch } from "diff"

export type ToolName = "read" | "write" | "edit" | "grep" | "find" | "ls" | "bash"

export type ReadToolInput = { path: string }
export type WriteToolInput = { path: string; content: string }
export type EditToolInput = { path: string; patch: string }
export type GrepToolInput = {
  pattern: string
  path?: string
  glob?: string
  ignoreCase?: boolean
  literal?: boolean
  context?: number
  limit?: number
}
export type FindToolInput = { pattern: string; path?: string; limit?: number }
export type LsToolInput = { path?: string; limit?: number }
export type BashToolInput = { command: string; args?: string[]; cwd?: string }

export type ToolExecutorOptions = {
  rootPath: string
}

export type ReadToolOutput = { path: string; content: string; size: number }
export type WriteToolOutput = { path: string; bytes: number }
export type EditToolOutput = { path: string; bytes: number }
export type GrepToolOutput = { matches: string }
export type FindToolOutput = { matches: string }
export type LsToolOutput = { entries: string[] }
export type BashToolOutput = { command: string; args: string[]; stdout: string; stderr: string; exitCode: number }

export type ToolExecutor = {
  readFile: (input: ReadToolInput) => Promise<ReadToolOutput>
  writeFile: (input: WriteToolInput) => Promise<WriteToolOutput>
  editFile: (input: EditToolInput) => Promise<EditToolOutput>
  grepFiles: (input: GrepToolInput) => Promise<GrepToolOutput>
  findFiles: (input: FindToolInput) => Promise<FindToolOutput>
  listDir: (input: LsToolInput) => Promise<LsToolOutput>
  runCommand: (input: BashToolInput, signal?: AbortSignal) => Promise<BashToolOutput>
}

const resolveWorkspacePath = (rootPath: string, targetPath: string) => {
  const root = resolve(rootPath)
  const resolved = resolve(root, targetPath)
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    throw new Error(`Path escapes workspace root: ${targetPath}`)
  }
  return resolved
}

const normalizePatchPath = (value?: string) => {
  if (!value) return undefined
  return value.replace(/^a\//, "").replace(/^b\//, "")
}

const applyUnifiedPatch = (original: string, patch: string, expectedPath: string) => {
  const patches = parsePatch(patch)
  if (patches.length !== 1) {
    throw new Error("Patch must target exactly one file.")
  }
  const target = patches[0]
  if (!target) {
    throw new Error("Patch is empty.")
  }
  const oldPath = normalizePatchPath(target.oldFileName)
  const newPath = normalizePatchPath(target.newFileName)
  if (oldPath && oldPath !== expectedPath && newPath && newPath !== expectedPath) {
    throw new Error(`Patch path mismatch: expected ${expectedPath}`)
  }
  const next = applyPatch(original, patch)
  if (next === false) {
    throw new Error("Patch failed to apply.")
  }
  return next
}

const spawnCommand = (
  command: string,
  args: string[],
  cwd: string,
  signal?: AbortSignal,
) =>
  new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
    const child = spawn(command, args, { cwd, signal, shell: false })
    let stdout = ""
    let stderr = ""

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })

    child.on("error", (error) => reject(error))
    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 0 })
    })
  })

export const createToolExecutor = (options: ToolExecutorOptions): ToolExecutor => {
  const rootPath = resolve(options.rootPath)

  return {
    readFile: async (input) => {
      const resolved = resolveWorkspacePath(rootPath, input.path)
      const content = await readFile(resolved, "utf-8")
      return { path: input.path, content, size: content.length }
    },
    writeFile: async (input) => {
      const resolved = resolveWorkspacePath(rootPath, input.path)
      await mkdir(dirname(resolved), { recursive: true })
      await writeFile(resolved, input.content, "utf-8")
      return { path: input.path, bytes: Buffer.byteLength(input.content, "utf-8") }
    },
    editFile: async (input) => {
      const resolved = resolveWorkspacePath(rootPath, input.path)
      const stats = await stat(resolved).catch(() => null)
      if (!stats || !stats.isFile()) {
        throw new Error(`File not found: ${input.path}`)
      }
      const original = await readFile(resolved, "utf-8")
      const updated = applyUnifiedPatch(original, input.patch, input.path)
      await writeFile(resolved, updated, "utf-8")
      return { path: input.path, bytes: Buffer.byteLength(updated, "utf-8") }
    },
    grepFiles: async (input) => {
      const args = ["-n", "--color=never", "--hidden"]
      if (input.ignoreCase) {
        args.push("-i")
      }
      if (input.literal) {
        args.push("-F")
      }
      if (input.context && input.context > 0) {
        args.push("-C", String(input.context))
      }
      if (input.limit && input.limit > 0) {
        args.push("-m", String(input.limit))
      }
      if (input.glob) {
        args.push("--glob", input.glob)
      }
      args.push(input.pattern)
      if (input.path) {
        const resolved = resolveWorkspacePath(rootPath, input.path)
        const relativePath = resolved === rootPath ? "." : relative(rootPath, resolved)
        args.push(relativePath)
      }
      const result = await spawnCommand("rg", args, rootPath)
      if (result.exitCode > 1) {
        throw new Error(result.stderr.trim() || "Grep failed.")
      }
      if (result.exitCode === 1) {
        return { matches: "" }
      }
      return { matches: result.stdout }
    },
    findFiles: async (input) => {
      const args = ["--files", "--color=never", "--hidden"]
      if (input.pattern) {
        args.push("--glob", input.pattern)
      }
      if (input.path) {
        const resolved = resolveWorkspacePath(rootPath, input.path)
        const relativePath = resolved === rootPath ? "." : relative(rootPath, resolved)
        args.push(relativePath)
      }
      const result = await spawnCommand("rg", args, rootPath)
      if (result.exitCode > 1) {
        throw new Error(result.stderr.trim() || "Find failed.")
      }
      if (result.exitCode === 1) {
        return { matches: "" }
      }
      return { matches: result.stdout }
    },
    listDir: async (input) => {
      const targetPath = input.path ?? "."
      const resolved = resolveWorkspacePath(rootPath, targetPath)
      const stats = await stat(resolved).catch(() => null)
      if (!stats || !stats.isDirectory()) {
        throw new Error(`Not a directory: ${targetPath}`)
      }
      const entries = await readdir(resolved)
      entries.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
      const formatted = await Promise.all(
        entries.map(async (entry) => {
          const entryPath = resolve(resolved, entry)
          const entryStats = await stat(entryPath).catch(() => null)
          if (!entryStats) return null
          return entryStats.isDirectory() ? `${entry}/` : entry
        }),
      )
      return { entries: formatted.filter((entry): entry is string => Boolean(entry)) }
    },
    runCommand: async (input, signal) => {
      const command = input.command.trim()
      if (!command) {
        throw new Error("Command is required.")
      }
      const cwd = input.cwd
        ? resolveWorkspacePath(rootPath, input.cwd)
        : rootPath
      const args = input.args ?? []
      const result = await spawnCommand(command, args, cwd, signal)
      return { command, args, ...result }
    },
  }
}
