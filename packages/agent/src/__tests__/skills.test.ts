import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { formatSkillsForPrompt, loadSkillsFromDir } from "../skills"

const createTempRoot = async () => mkdtemp(join(tmpdir(), "bbot-skills-"))

const writeSkill = async (root: string, dirName: string, content: string) => {
  const dir = join(root, dirName)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "SKILL.md"), content, "utf-8")
}

describe("skills", () => {
  let root = ""

  beforeEach(async () => {
    root = await createTempRoot()
  })

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("loads only valid skills", async () => {
    await writeSkill(
      root,
      "valid-skill",
      `---
name: valid-skill
description: Valid skill
---
Do the thing.`,
    )

    await writeSkill(
      root,
      "invalid-skill",
      `---
name: wrong-name
description: Invalid skill
---
Nope.`,
    )

    await writeSkill(
      root,
      "missing-desc",
      `---
name: missing-desc
---
No description.`,
    )

    const skills = loadSkillsFromDir({ dir: root, source: "path" })
    const names = skills.map((skill) => skill.name).sort()

    expect(names).toEqual(["valid-skill"])
  })

  it("formats prompt output and respects disable-model-invocation", async () => {
    await writeSkill(
      root,
      "visible-skill",
      `---
name: visible-skill
description: Visible skill
---
Use this.`,
    )

    await writeSkill(
      root,
      "hidden-skill",
      `---
name: hidden-skill
description: Hidden skill
disable-model-invocation: true
---
Hidden.`,
    )

    const skills = loadSkillsFromDir({ dir: root, source: "path" })
    const prompt = formatSkillsForPrompt(skills)

    expect(prompt).toContain("<available_skills>")
    expect(prompt).toContain("<name>visible-skill</name>")
    expect(prompt).toContain("<description>Visible skill</description>")
    expect(prompt).not.toContain("hidden-skill")
  })

  it("parses allowed tools from frontmatter", async () => {
    await writeSkill(
      root,
      "tool-skill",
      `---
name: tool-skill
description: Tool skill
allowedTools:
  - read
  - write
---
Use tools.`,
    )

    const skills = loadSkillsFromDir({ dir: root, source: "path" })
    expect(skills).toHaveLength(1)
    expect(skills[0]?.allowedTools).toEqual(["read", "write"])
  })

  it("skips skills under node_modules", async () => {
    await writeSkill(
      root,
      "valid-skill",
      `---
name: valid-skill
description: Valid skill
---
Do the thing.`,
    )

    await writeSkill(
      join(root, "node_modules"),
      "ignored-skill",
      `---
name: ignored-skill
description: Ignore me
---
Nope.`,
    )

    const skills = loadSkillsFromDir({ dir: root, source: "path" })
    const names = skills.map((skill) => skill.name).sort()

    expect(names).toEqual(["valid-skill"])
  })
})
