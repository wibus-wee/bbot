import { consola } from "consola"

import type { ApiClient } from "./api"
import { createMessageUpdater, type TelegramApi } from "./messages"

export const streamRun = async (options: {
  apiClient: ApiClient
  botApi: TelegramApi
  chatId: number
  runId: string
  onTerminal?: (eventName: string) => void
}) => {
  const controller = new AbortController()
  let completed = false
  const updater = createMessageUpdater(options.botApi, options.chatId, {
    throttleMs: 700,
    maxLength: 3800,
  })
  const typingInterval = setInterval(() => {
    void options.botApi.sendChatAction(options.chatId, "typing")
  }, 4500)

  void options.botApi.sendChatAction(options.chatId, "typing")

  const { stream } = await options.apiClient.sse.get({
    url: "/runs/{id}/stream",
    path: { id: options.runId },
    signal: controller.signal,
    onSseEvent: (event) => {
      const eventName = event.event ?? ""
      if (eventName === "stream.ready") {
        return
      }

      const data = event.data as { message?: string } | undefined
      const message = data?.message ?? eventName
      if (message) {
        updater.append(message)
      }

      if (
        eventName === "run.completed" ||
        eventName === "run.failed" ||
        eventName === "run.canceled"
      ) {
        completed = true
        options.onTerminal?.(eventName)
        controller.abort()
      }
    },
  })

  try {
    for await (const _ of stream) {
      if (completed) break
    }
  } catch (error) {
    if (!completed) {
      const message = error instanceof Error ? error.message : String(error)
      consola.warn(`SSE stream failed: ${message}`)
    }
  } finally {
    clearInterval(typingInterval)
    await updater.close()
  }
}
