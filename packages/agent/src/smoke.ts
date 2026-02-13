import { runAgent } from "./index"

const prompt = process.argv.slice(2).join(" ").trim() || "List the repository root."

const run = async () => {
  try {
    const result = await runAgent({
      prompt,
      workspaceRoot: process.cwd(),
      onEvent: (event) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          process.stdout.write(event.assistantMessageEvent.delta)
        }
        if (event.type === "tool_execution_end") {
          const status = event.isError ? "error" : "ok"
          process.stdout.write(`\n[tool:${event.toolName}:${status}]\n`)
        }
      },
    })

    const lastMessage = result.state.messages[result.state.messages.length - 1]
    process.stdout.write(`\n\n[done] ${lastMessage ? "agent idle" : "no messages"}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`\n[smoke] failed: ${message}\n`)
    process.exitCode = 1
  }
}

void run()
