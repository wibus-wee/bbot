import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import { createToolExecutor } from "../index"

const hasRg = () => {
  const result = spawnSync("rg", ["--version"], { stdio: "ignore" })
  return result.status === 0
}

const withTempRoot = async <T>(fn: (root: string) => Promise<T>) => {
  const root = await mkdtemp(join(tmpdir(), "bbot-tools-"))
  try {
    return await fn(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe("tool executor", () => {
  it("writes, reads, and edits files", async () => {
    await withTempRoot(async (root) => {
      const executor = createToolExecutor({ rootPath: root })

      await executor.writeFile({ path: "note.txt", content: "Hello\n" })
      const read = await executor.readFile({ path: "note.txt" })
      expect(read.content).toBe("Hello\n")

      const patch = [
        "*** Begin Patch",
        "*** Update File: note.txt",
        "@@",
        "-Hello",
        "+Hello world",
        "*** End Patch",
      ].join("\n")

      await executor.editFile({ patch })
      const updated = await executor.readFile({ path: "note.txt" })
      expect(updated.content).toBe("Hello world\n")
    })
  })

  it("does not modify files when patch fails", async () => {
    await withTempRoot(async (root) => {
      const executor = createToolExecutor({ rootPath: root })
      await executor.writeFile({ path: "note.txt", content: "Alpha\n" })

      const badPatch = [
        "*** Begin Patch",
        "*** Update File: note.txt",
        "@@",
        "-Beta",
        "+Gamma",
        "*** End Patch",
      ].join("\n")

      await expect(
        executor.editFile({ patch: badPatch }),
      ).rejects.toThrow("Failed to find expected lines")

      const read = await executor.readFile({ path: "note.txt" })
      expect(read.content).toBe("Alpha\n")
    })
  })

  it("blocks path traversal outside the workspace", async () => {
    await withTempRoot(async (root) => {
      const executor = createToolExecutor({ rootPath: root })
      await expect(executor.readFile({ path: "../outside.txt" })).rejects.toThrow(
        "Path escapes workspace root",
      )
    })
  })

  const maybeIt = hasRg() ? it : it.skip
  maybeIt("greps files with ripgrep", async () => {
    await withTempRoot(async (root) => {
      await mkdir(join(root, "docs"), { recursive: true })
      await writeFile(join(root, "docs", "note.md"), "needle\n", "utf-8")

      const executor = createToolExecutor({ rootPath: root })
      const result = await executor.grepFiles({ pattern: "needle", path: "docs" })

      expect(result.matches).toContain("note.md:1:needle")
    })
  })

  maybeIt("finds files with ripgrep", async () => {
    await withTempRoot(async (root) => {
      await mkdir(join(root, "docs"), { recursive: true })
      await writeFile(join(root, "docs", "note.md"), "content\n", "utf-8")

      const executor = createToolExecutor({ rootPath: root })
      const result = await executor.findFiles({ pattern: "*.md", path: "docs" })

      expect(result.matches).toContain("note.md")
    })
  })

  it("lists directory contents", async () => {
    await withTempRoot(async (root) => {
      await mkdir(join(root, "docs"), { recursive: true })
      await writeFile(join(root, "note.txt"), "hello\n", "utf-8")

      const executor = createToolExecutor({ rootPath: root })
      const result = await executor.listDir({ path: "." })

      expect(result.entries).toContain("docs/")
      expect(result.entries).toContain("note.txt")
    })
  })

  it("runs bash commands", async () => {
    await withTempRoot(async (root) => {
      const command = process.execPath
      const executor = createToolExecutor({ rootPath: root })
      const result = await executor.runCommand({
        command,
        args: ["-e", "console.log('ok')"],
      })

      expect(result.stdout).toContain("ok")
      expect(result.exitCode).toBe(0)
    })
  })
})
