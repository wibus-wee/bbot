import { spawn } from "node:child_process"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, resolve, sep } from "node:path"

import { applyPatch, parsePatch } from "diff"

export type ToolName = "read" | "write" | "edit" | "search" | "bash"

export type ReadToolInput = { path: string }
export type WriteToolInput = { path: string; content: string }
export type EditToolInput = { path: string; patch: string }
export type SearchToolInput = { query: string; path?: string; maxResults?: number }
export type BashToolInput = { command: string; args?: string[]; cwd?: string }

export type ToolExecutorOptions = {
  rootPath: string
  bashAllowlist: string[]
}

export type ReadToolOutput = { path: string; content: string; size: number }
export type WriteToolOutput = { path: string; bytes: number }
export type EditToolOutput = { path: string; bytes: number }
export type SearchToolOutput = { matches: string }
export type BashToolOutput = { command: string; args: string[]; stdout: string; stderr: string; exitCode: number }

export type ToolExecutor = {
  readFile: (input: ReadToolInput) => Promise<ReadToolOutput>
  writeFile: (input: WriteToolInput) => Promise<WriteToolOutput>
  editFile: (input: EditToolInput) => Promise<EditToolOutput>
  searchFiles: (input: SearchToolInput) => Promise<SearchToolOutput>
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
  const bashAllowlist = options.bashAllowlist.map((entry) => entry.trim()).filter(Boolean)

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
    searchFiles: async (input) => {
      const args = ["-n", "--color=never"]
      if (input.maxResults && input.maxResults > 0) {
        args.push("-m", String(input.maxResults))
      }
      args.push(input.query)
      if (input.path) {
        const resolved = resolveWorkspacePath(rootPath, input.path)
        const relative = resolved === rootPath ? "." : resolved
        args.push(relative)
      }
      const result = await spawnCommand("rg", args, rootPath)
      if (result.exitCode > 1) {
        throw new Error(result.stderr.trim() || "Search failed.")
      }
      return { matches: result.stdout }
    },
    runCommand: async (input, signal) => {
      const command = input.command.trim()
      if (!command) {
        throw new Error("Command is required.")
      }
      if (bashAllowlist.length === 0) {
        throw new Error("Bash is disabled: allowlist is empty.")
      }
      if (!bashAllowlist.includes(command)) {
        throw new Error(`Command not allowed: ${command}`)
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
