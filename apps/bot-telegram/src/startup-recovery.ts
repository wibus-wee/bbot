import { consola } from "consola"

import type { ApiClient } from "./api"
import { listRecoveryRuns } from "./api"
import { createRequestId } from "./request-id"

type AttachRun = (input: {
  chatId: number
  sessionId: string
  runId: string
  requestId: string
}) => Promise<void>

type RecoveryRun = {
  runId: string
  sessionId: string
  status: string
  prompt: string
  chatId: number
}

type RawRecoveryRun = {
  runId: string
  sessionId: string
  status: string
  prompt: string
  chatId: string | number
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const loadRecoveryRuns = async (apiClient: ApiClient): Promise<RecoveryRun[]> => {
  const maxAttempts = 5
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const runs = await listRecoveryRuns(apiClient, {
        requestId: createRequestId(),
      })
      if (runs.length > 0 || attempt === maxAttempts) {
        return (runs as RawRecoveryRun[])
          .map((run) => {
            const rawChatId =
              typeof run.chatId === "string" ? Number(run.chatId) : run.chatId
            return {
              runId: run.runId,
              sessionId: run.sessionId,
              status: run.status,
              prompt: run.prompt,
              chatId: Number.isFinite(rawChatId) ? rawChatId : 0,
            }
          })
          .filter((run) => run.chatId > 0)
      }
    } catch (error) {
      consola.warn({ error, attempt }, "Failed to load recovery runs")
      if (attempt === maxAttempts) {
        return []
      }
    }

    await wait(1000)
  }

  return []
}

export const resumeInterruptedRuns = async (options: {
  apiClient: ApiClient
  attachRun: AttachRun
}) => {
  const recoveryRuns = await loadRecoveryRuns(options.apiClient)
  for (const run of recoveryRuns) {
    try {
      await options.attachRun({
        chatId: run.chatId,
        sessionId: run.sessionId,
        runId: run.runId,
        requestId: createRequestId(),
      })
    } catch (error) {
      consola.warn({ error, runId: run.runId }, "Failed to attach recovery run")
    }
  }
}
