---
name: pi-coding-agent
description: Guide for building and understanding minimal, self-contained LLM coding agents following the design principles of Pi. Use when designing or customizing AI agents that act as code assistants, especially when opinionated simplicity, robust context management, multi-model support, and deterministic toolchains are desired.
---

# Pi Coding Agent Design Skill

This skill guides the creation and customization of LLM-based coding agents using the design principles from the Pi project. It covers session modeling, tool integration, deterministic interaction patterns, and minimalistic architecture for code assistants.

---

## Core Workflow

Pi operates as a loop-based autonomous agent that iteratively runs an LLM on a structured session object. It strictly controls context, uses deterministic tools, and enforces opinionated design constraints for reproducibility and user trust.

### 1. Agent Loop Architecture

The agent operates in a **deterministic REPL loop**:

```plaintext
session → LLM → Thought → Tool Call → Result → Append → next LLM loop
```

Each turn includes:

- **Thought**: LLM response with `action` and `thought`.
- **Tool Call**: Executes the action (`read`, `write`, `edit`, `bash`, etc.).
- **Result**: Output from tool is stored.
- **Session**: Updated and passed to next round.

Use `scripts/session_loop.ts` (see bundled resources) to implement and replay session turns.

---

## Session Modeling

Sessions are modeled as **JSON state logs** with `messages`, `actions`, `results`, and `files`. Everything Pi does is **append-only**, enabling full reproducibility and "time travel".

### Example session structure

```json
{
  "messages": [{ "role": "user", "content": "Create a Next.js app" }],
  "actions": [{ "tool": "bash", "input": "npx create-next-app@latest" }],
  "results": [{ "output": "...log output..." }],
  "files": [{ "path": "app/page.tsx", "content": "..." }]
}
```

---

## Tools: Minimal and Deterministic

Pi supports a fixed set of tools. They are opinionatedly limited to reduce ambiguity and increase predictability:

| Tool     | Description                      |
|----------|----------------------------------|
| `read`   | Read a file                      |
| `write`  | Create or overwrite a file       |
| `edit`   | Structured patch on file content |
| `bash`   | Execute a shell command          |
| `search` | Search string in files           |
| `plan`   | (Optional) High-level strategy   |

Each tool returns a JSON output. Agent only emits tools; **no "freeform" suggestions** are allowed outside actions.

Tool usage is fully reproducible. Results are always added to session.

---

## Context Engineering

Rather than stuffing transcripts, Pi **carefully crafts prompts** using only what’s needed:

- Includes: system prompt, recent messages, `files`, past `actions/results`
- Does **not** replay entire transcript — avoids stale or misaligned state

Prompt construction is deterministic and template-driven:
See `references/prompt_template.md` for format.

---

## Multi-Model Support

Pi supports multiple models (e.g. Claude, GPT-4) in the same session:

- The session tracks which model generated each action
- `models/` folder defines capabilities and request builders for each model

This makes it easy to test behavior across models with the same input, enabling model ablation experiments or hybrid strategies.

---

## Design Philosophy

Pi is intentionally **opinionated and minimal**. Its principles:

- 🧱 **No plugins, no ambiguity** – all tools are deterministic and pre-defined
- 🛤 **Reproducibility over intelligence** – session log can always be replayed
- 🧠 **LLM is an agent, not a genie** – structured actions > freeform outputs
- 🧹 **Minimal prompt bloat** – avoids runaway context
- 🤖 **Composable and inspectable** – sessions can be inspected, replayed, diffed, stored

---

## Suggested Usage Patterns

Use this skill when:

- Designing a new LLM coding agent with reproducible sessions
- Creating tool-based agent loops for scripting or project generation
- Needing a structured format for context control and multi-turn sessions
- Wanting to integrate multiple models in the same session
- Replaying or debugging agent outputs deterministically

---

## Bundled Resources

- `scripts/session_loop.ts`: Pi-style REPL loop runner
- `scripts/replay_session.ts`: Reconstruct and replay full session
- `references/prompt_template.md`: Base prompt template for context engineering
- `references/tools_spec.md`: JSON specs for `read`, `write`, `edit`, `bash`, `search`

For example tool specs, see:

```markdown
## Example Tool Format

```json
{
  "tool": "write",
  "input": {
    "path": "app/page.tsx",
    "content": "<tsx code here>"
  }
}
```
```
