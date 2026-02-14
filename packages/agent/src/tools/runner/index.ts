import { spawn } from "node:child_process"
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, relative, resolve, sep } from "node:path"

import {
  InvalidHunkError,
  InvalidPatchError,
  applyUpdateChunks,
  parsePatch,
} from "./apply-patch"

export type ToolName = "read" | "write" | "edit" | "grep" | "find" | "ls" | "bash"

export type ReadToolInput = { path: string }
export type WriteToolInput = { path: string; content: string }
export type EditToolInput = { patch: string }
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
export type EditToolOutput = { added: string[]; modified: string[]; deleted: string[] }
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
  if (isAbsolute(targetPath)) {
    return resolve(targetPath)
  }
  return resolve(rootPath, targetPath)
}

const resolveCommandCwd = (rootPath: string, targetPath?: string) => {
  if (!targetPath) return resolve(rootPath)
  return resolve(rootPath, targetPath)
}

const applyPatchToWorkspace = async (rootPath: string, patch: string) => {
  let parsed
  try {
    parsed = parsePatch(patch)
  } catch (error) {
    if (error instanceof InvalidPatchError) {
      throw new Error(`Invalid patch: ${error.message}`)
    }
    if (error instanceof InvalidHunkError) {
      throw new Error(
        `Invalid patch hunk on line ${error.lineNumber}: ${error.message}`,
      )
    }
    throw error
  }

  const { hunks } = parsed
  if (hunks.length === 0) {
    throw new Error("No files were modified.")
  }

  const added: string[] = []
  const modified: string[] = []
  const deleted: string[] = []

  for (const hunk of hunks) {
    switch (hunk.type) {
      case "add": {
        const resolved = resolveWorkspacePath(rootPath, hunk.path)
        const parent = dirname(resolved)
        if (parent && parent !== ".") {
          await mkdir(parent, { recursive: true })
        }
        await writeFile(resolved, hunk.contents, "utf-8")
        added.push(relative(rootPath, resolved))
        break
      }
      case "delete": {
        const resolved = resolveWorkspacePath(rootPath, hunk.path)
        await unlink(resolved)
        deleted.push(relative(rootPath, resolved))
        break
      }
      case "update": {
        const resolved = resolveWorkspacePath(rootPath, hunk.path)
        const original = await readFile(resolved, "utf-8")
        const updated = applyUpdateChunks(original, hunk.chunks, hunk.path)
        if (hunk.movePath) {
          const destination = resolveWorkspacePath(rootPath, hunk.movePath)
          if (destination !== resolved) {
            const parent = dirname(destination)
            if (parent && parent !== ".") {
              await mkdir(parent, { recursive: true })
            }
            await writeFile(destination, updated, "utf-8")
            await unlink(resolved)
            modified.push(relative(rootPath, destination))
            break
          }
        }
        await writeFile(resolved, updated, "utf-8")
        modified.push(relative(rootPath, resolved))
        break
      }
    }
  }

  return { added, modified, deleted }
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
    editFile: async (input) => applyPatchToWorkspace(rootPath, input.patch),
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
      const cwd = resolveCommandCwd(rootPath, input.cwd)
      const args = input.args ?? []
      const result = await spawnCommand(command, args, cwd, signal)
      return { command, args, ...result }
    },
  }
}
