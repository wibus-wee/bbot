import { describe, expect, it } from "vitest"

import { buildSystemPrompt } from "../system-prompt"

describe("system-prompt", () => {
  it("builds a default prompt with tools and guidelines", () => {
    const prompt = buildSystemPrompt({
      cwd: "/repo",
      tools: [
        { name: "read" },
        { name: "write" },
        { name: "edit" },
        { name: "grep" },
        { name: "find" },
        { name: "ls" },
        { name: "bash" },
      ],
      now: new Date("2025-01-02T03:04:05Z"),
    })

    expect(prompt).toContain("Available tools:")
    expect(prompt).toContain("- read:")
    expect(prompt).toContain("- edit:")
    expect(prompt).toContain("- grep:")
    expect(prompt).toContain("Guidelines:")
    expect(prompt).toContain("Use edit for precise changes")
    expect(prompt).toContain("Use grep to search file contents")
    expect(prompt).toContain("Current date and time:")
    expect(prompt).toContain("Current working directory: /repo")
  })

  it("honors custom prompt, append prompt, context, and skills", () => {
    const prompt = buildSystemPrompt({
      customPrompt: "Custom system prompt.",
      appendSystemPrompt: "Appended rules.",
      cwd: "/repo",
      tools: [{ name: "read" }],
      contextFiles: [{ path: "/repo/AGENTS.md", content: "Do the thing." }],
      skills: [
        {
          name: "demo-skill",
          description: "Demo skill",
          filePath: "/repo/.agents/skills/demo/skill.md",
          baseDir: "/repo/.agents/skills/demo",
          origin: "path",
          disableModelInvocation: false,
        },
      ],
      now: new Date("2025-01-02T03:04:05Z"),
    })

    expect(prompt).toContain("Custom system prompt.")
    expect(prompt).toContain("Appended rules.")
    expect(prompt).toContain("# Project Context")
    expect(prompt).toContain("## /repo/AGENTS.md")
    expect(prompt).toContain("<available_skills>")
    expect(prompt).toContain("<name>demo-skill</name>")
  })

  it("adds SOUL guidance when SOUL.md is present", () => {
    const prompt = buildSystemPrompt({
      cwd: "/repo",
      tools: [{ name: "read" }],
      contextFiles: [
        { path: "/repo/AGENTS.md", content: "Do the thing." },
        { path: "/repo/SOUL.md", content: "Persona." },
      ],
    })

    expect(prompt).toContain("If SOUL.md is present, embody its persona and tone")
  })
})
