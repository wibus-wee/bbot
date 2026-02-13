import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { loadProjectContextFiles } from "../resource-loader"

const createTempRoot = async () => mkdtemp(join(tmpdir(), "bbot-context-"))

const writeContext = async (dir: string, filename: string, content: string) => {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, filename), content, "utf-8")
}

describe("resource-loader", () => {
  let root = ""

  beforeEach(async () => {
    root = await createTempRoot()
  })

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("loads global and ancestor context files in order", async () => {
    const globalDir = join(root, "global")
    const projectRoot = join(root, "project")
    const parent = join(projectRoot, "parent")
    const child = join(parent, "child")

    await writeContext(globalDir, "AGENTS.md", "Global")
    await writeContext(projectRoot, "AGENTS.md", "Project")
    await writeContext(parent, "CLAUDE.md", "Parent")
    await writeContext(child, "AGENTS.md", "Child")

    const files = loadProjectContextFiles({ cwd: child, agentDir: globalDir })
    const paths = files.map((entry) => entry.path)
    const contents = files.map((entry) => entry.content)

    expect(paths[0]).toBe(join(globalDir, "AGENTS.md"))
    expect(paths[1]).toBe(join(projectRoot, "AGENTS.md"))
    expect(paths[2]).toBe(join(parent, "CLAUDE.md"))
    expect(paths[3]).toBe(join(child, "AGENTS.md"))

    expect(contents).toEqual(["Global", "Project", "Parent", "Child"])
  })
})
