import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { expandSkillCommand } from "../skill-command"
import type { Skill } from "../skills"

const createTempRoot = async () => mkdtemp(join(tmpdir(), "bbot-skill-"))

describe("skill-command", () => {
  let root = ""

  beforeEach(async () => {
    root = await createTempRoot()
  })

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("expands /skill:NAME with skill content and args", async () => {
    const skillDir = join(root, "demo-skill")
    await mkdir(skillDir, { recursive: true })
    const filePath = join(skillDir, "SKILL.md")

    await writeFile(
      filePath,
      `---\nname: demo-skill\ndescription: Demo\n---\nDo the thing.`,
      "utf-8",
    )

    const skill: Skill = {
      name: "demo-skill",
      description: "Demo",
      filePath,
      baseDir: skillDir,
      origin: "path",
      disableModelInvocation: false,
    }

    const expanded = expandSkillCommand("/skill:demo-skill extra", [skill])

    expect(expanded).toContain("<skill name=\"demo-skill\"")
    expect(expanded).toContain("References are relative to")
    expect(expanded).toContain("Do the thing.")
    expect(expanded).toContain("\n\nextra")
  })

  it("returns original text when skill is missing", () => {
    const text = "/skill:missing"
    expect(expandSkillCommand(text, [])).toBe(text)
  })
})
