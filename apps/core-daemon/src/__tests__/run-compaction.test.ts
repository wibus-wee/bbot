import { describe, expect, it, vi } from "vitest"

vi.mock("../modules/runs/service", async () => {
  const actual = await vi.importActual<typeof import("../modules/runs/service")>(
    "../modules/runs/service",
  )
  return {
    ...actual,
    createRunEvent: vi.fn(),
    getLatestSessionSummary: vi.fn(),
    getRun: vi.fn(),
    listRunsBySessionStatus: vi.fn(),
    listSessionEntries: vi.fn(),
    updateRunStatusIf: vi.fn(),
  }
})

vi.mock("../modules/workspaces/service", () => ({
  getWorkspace: vi.fn(),
  compactWorkspaceSession: vi.fn(),
}))

vi.mock("../modules/agent-providers/runtime", () => ({
  resolveAgentRuntimeConfig: vi.fn(() => ({
    provider: "test",
    model: "test",
    systemPrompt: "",
    compaction: {
      enabled: true,
      reserveTokens: 0,
      keepRecentTokens: 0,
      autoCompactTokenLimit: 100,
    },
    thinkingLevel: "off",
    mcpServers: [],
  })),
}))

vi.mock("@bbot/agent", () => ({
  runAgent: vi.fn(),
  buildContextMessages: vi.fn(() => []),
}))

import { RunDispatcher } from "../modules/runs/dispatcher"
import {
  createRunEvent,
  getLatestSessionSummary,
  getRun,
  listSessionEntries,
  updateRunStatusIf,
} from "../modules/runs/service"
import { compactWorkspaceSession, getWorkspace } from "../modules/workspaces/service"
import { runAgent } from "@bbot/agent"

describe("RunDispatcher auto compaction", () => {
  it("compacts before starting a run when usage exceeds limit", async () => {
    const db = {} as any
    let status: "queued" | "running" | "succeeded" = "queued"

    vi.mocked(getRun).mockImplementation(async () => ({
      id: "run_1",
      sessionId: "session_1",
      prompt: "Hello",
      status,
    }) as any)

    vi.mocked(updateRunStatusIf).mockImplementation(async (_db, _id, statuses, input) => {
      if (statuses.includes(status)) {
        status = input.status as typeof status
        return {
          id: "run_1",
          sessionId: "session_1",
          prompt: "Hello",
          status,
        } as any
      }
      return null
    })

    vi.mocked(getWorkspace).mockResolvedValueOnce({ rootPath: "/tmp" } as any)
    vi.mocked(getLatestSessionSummary).mockResolvedValue(null)
    vi.mocked(listSessionEntries).mockResolvedValue([
      {
        payload: {
          role: "assistant",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 120,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
        },
      },
    ] as any)

    vi.mocked(compactWorkspaceSession).mockResolvedValue({
      didCompact: true,
      summary: "summary",
    })

    vi.mocked(runAgent).mockImplementation(async () => {
      expect(compactWorkspaceSession).toHaveBeenCalledWith(db, {
        sessionId: "session_1",
      })
      return { state: {} as any, skills: [] }
    })

    const dispatcher = new RunDispatcher(db)

    dispatcher.enqueue("run_1", "session_1")

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(createRunEvent).toHaveBeenCalled()
  })
})
