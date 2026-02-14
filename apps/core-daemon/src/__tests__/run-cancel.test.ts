import { describe, expect, it, vi } from "vitest"

vi.mock("../modules/runs/service", async () => {
  const actual = await vi.importActual<typeof import("../modules/runs/service")>(
    "../modules/runs/service",
  )
  return {
    ...actual,
    getRun: vi.fn(),
    updateRunStatusIf: vi.fn(),
    createRunEvent: vi.fn(),
    listRunsBySessionStatus: vi.fn(),
    listSessionEntries: vi.fn(),
    getLatestSessionSummary: vi.fn(),
  }
})

vi.mock("../modules/workspaces/service", () => ({
  getWorkspace: vi.fn(),
}))

vi.mock("@bbot/agent", () => ({
  runAgent: vi.fn(),
  loadAgentConfig: vi.fn(() => ({
    provider: "test",
    model: "test",
    systemPrompt: "",
    compaction: {
      enabled: false,
      reserveTokens: 0,
      keepRecentTokens: 0,
    },
    thinkingLevel: "off",
  })),
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
import { runAgent } from "@bbot/agent"
import { getWorkspace } from "../modules/workspaces/service"

describe("RunDispatcher cancellation", () => {
  it("cancels a running run and aborts the agent", async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, "abort")
    const db = {} as any
    let status: "queued" | "running" | "canceled" = "queued"
    let agentStartedResolve: (() => void) | null = null
    const agentStarted = new Promise<void>((resolve) => {
      agentStartedResolve = resolve
    })

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
    vi.mocked(listSessionEntries).mockResolvedValue([])

    vi.mocked(runAgent).mockImplementation(async ({ abortSignal }) => {
      expect(abortSignal).toBeDefined()
      agentStartedResolve?.()
      await new Promise<void>((resolve) => {
        abortSignal?.addEventListener("abort", () => resolve(), { once: true })
      })
      return { state: {} as any, skills: [] }
    })

    const dispatcher = new RunDispatcher(db)

    dispatcher.enqueue("run_1", "session_1")
    await agentStarted

    await dispatcher.cancelRun("run_1", "user")

    expect(abortSpy).toHaveBeenCalled()
    expect(createRunEvent).toHaveBeenCalledWith(
      db,
      "run_1",
      expect.objectContaining({ type: "run.canceled" }),
    )
  })
})
