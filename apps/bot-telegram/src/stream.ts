import { consola } from "consola"

import type { ApiClient } from "./api"
import {
  createChunkedMessageUpdater,
  createMessageUpdater,
  escapeMarkdownV2,
  markdownToMarkdownV2,
  type TelegramApi,
} from "./messages"

export const streamRun = async (options: {
  apiClient: ApiClient
  botApi: TelegramApi
  chatId: number
  runId: string
  onTerminal?: (eventName: string) => void
}) => {
  const controller = new AbortController()
  let completed = false
  const assistantUpdater = createChunkedMessageUpdater(options.botApi, options.chatId, {
    throttleMs: 700,
    maxLength: 3800,
    parseMode: "MarkdownV2",
    fallbackToNewMessage: false,
    transform: markdownToMarkdownV2,
  })
  const thinkingUpdater = createChunkedMessageUpdater(options.botApi, options.chatId, {
    throttleMs: 500,
    maxLength: 3800,
    parseMode: "MarkdownV2",
    fallbackToNewMessage: false,
    transform: markdownToMarkdownV2,
  })
  let toolUpdater: ReturnType<typeof createMessageUpdater> | null = null
  let toolBatchActive = false
  let assistantText = ""
  let thinkingText = ""
  let lastLiveSeq = 0
  let lastMessageSeq = 0
  const seenRunEventIds = new Set<string>()
  const seenMessageIds = new Set<string>()
  let failedText: string | null = null
  const typingInterval = setInterval(() => {
    void options.botApi.sendChatAction(options.chatId, "typing")
  }, 4500)

  void options.botApi.sendChatAction(options.chatId, "typing")

  const normalizeRunMessage = (message: string, prefix: string) =>
    message.startsWith(prefix) ? message.slice(prefix.length).trim() : message

  const formatToolLabel = (message?: string) => {
    if (!message) return "Tool executed"
    const trimmed = message.trim()
    return normalizeRunMessage(trimmed, "Tool executed: ")
  }

  const endToolBatch = () => {
    if (!toolBatchActive) return
    toolBatchActive = false
    if (toolUpdater) {
      void toolUpdater.close()
      toolUpdater = null
    }
  }

  const getToolUpdater = (): ReturnType<typeof createMessageUpdater> => {
    if (!toolUpdater || !toolBatchActive) {
      if (toolUpdater) {
        void toolUpdater.close()
      }
      toolUpdater = createMessageUpdater(options.botApi, options.chatId, {
        throttleMs: 300,
        maxLength: 500,
        parseMode: "MarkdownV2",
        fallbackToNewMessage: false,
      })
    }
    toolBatchActive = true
    return toolUpdater!
  }

  const { stream } = await options.apiClient.sse.get({
    url: "/runs/{id}/stream",
    path: { id: options.runId },
    signal: controller.signal,
    onSseEvent: (event) => {
      const eventName = event.event ?? ""
      if (eventName === "stream.ready") {
        return
      }

      const data = event.data as {
        message?: string
        text?: string
        id?: string
        sequence?: number
      } | undefined
      const message = data?.message ?? eventName
      const sequence = typeof data?.sequence === "number" ? data.sequence : null
      const eventId = typeof data?.id === "string" ? data.id : null

      const isLiveEvent = [
        "assistant.delta",
        "assistant.thinking",
        "assistant.thinking_delta",
        "assistant.thinking_start",
      ].includes(eventName)

      if (isLiveEvent && typeof sequence === "number") {
        if (sequence <= lastLiveSeq) return
        lastLiveSeq = sequence
      }

      if (eventName === "assistant.message") {
        if (typeof sequence === "number") {
          if (sequence <= lastMessageSeq) return
          lastMessageSeq = sequence
        }
        if (eventId) {
          if (seenMessageIds.has(eventId)) return
          seenMessageIds.add(eventId)
        }
      } else if (eventId) {
        if (seenRunEventIds.has(eventId)) return
        seenRunEventIds.add(eventId)
      }
      if (eventName === "assistant.delta") {
        endToolBatch()
        const delta =
          typeof data?.message === "string"
            ? data.message
            : typeof data?.text === "string"
              ? data.text
              : message
        if (delta) {
          assistantText += delta
          assistantUpdater.set(assistantText)
        }
        return
      }

      if (eventName === "assistant.message") {
        endToolBatch()
        const text =
          typeof data?.message === "string"
            ? data.message
            : typeof data?.text === "string"
              ? data.text
              : message
        if (text) {
          assistantText = text
          assistantUpdater.set(assistantText)
        }
        return
      }

      if (eventName === "assistant.thinking_start") {
        endToolBatch()
        thinkingText = ""
        return
      }

      if (eventName === "assistant.thinking_delta") {
        endToolBatch()
        const delta =
          typeof data?.message === "string"
            ? data.message
            : typeof data?.text === "string"
              ? data.text
              : message
        if (delta) {
          thinkingText += delta
          if (thinkingText.trim()) {
            thinkingUpdater.set(thinkingText)
          }
        }
        return
      }

      if (eventName === "assistant.thinking") {
        endToolBatch()
        const text =
          typeof data?.message === "string"
            ? data.message
            : typeof data?.text === "string"
              ? data.text
              : message
        if (text) {
          thinkingText = text
          thinkingUpdater.set(thinkingText)
        }
        return
      }

      if (eventName === "tool.executed") {
        const label = formatToolLabel(message)
        getToolUpdater().set(`Tool: ${escapeMarkdownV2(label)}`)
        return
      }

      if (eventName === "run.completed") {
        endToolBatch()
        completed = true
        options.onTerminal?.(eventName)
        controller.abort()
        return
      }

      if (eventName === "run.failed") {
        endToolBatch()
        failedText = normalizeRunMessage(message, "Run failed:")
        if (failedText) {
          assistantUpdater.set(failedText)
        }
        completed = true
        options.onTerminal?.(eventName)
        controller.abort()
        return
      }

      if (eventName === "run.canceled") {
        endToolBatch()
        completed = true
        options.onTerminal?.(eventName)
        controller.abort()
        return
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
    if (toolUpdater) {
      await toolUpdater.close()
    }
    await thinkingUpdater.close()
    await assistantUpdater.close()
  }
}
