import { consola } from "consola"

import type { ApiClient } from "./api"
import { createMessageUpdater, type TelegramApi } from "./messages"

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")

export const streamRun = async (options: {
  apiClient: ApiClient
  botApi: TelegramApi
  chatId: number
  runId: string
  onTerminal?: (eventName: string) => void
}) => {
  const controller = new AbortController()
  let completed = false
  const assistantUpdater = createMessageUpdater(options.botApi, options.chatId, {
    throttleMs: 700,
    maxLength: 3800,
    parseMode: "HTML",
    fallbackToNewMessage: false,
  })
  const toolUpdater = createMessageUpdater(options.botApi, options.chatId, {
    throttleMs: 300,
    maxLength: 500,
    parseMode: "HTML",
    fallbackToNewMessage: false,
  })
  let assistantText = ""
  let receivedDelta = false
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

  const { stream } = await options.apiClient.sse.get({
    url: "/runs/{id}/stream",
    path: { id: options.runId },
    signal: controller.signal,
    onSseEvent: (event) => {
      const eventName = event.event ?? ""
      if (eventName === "stream.ready") {
        return
      }

      const data = event.data as { message?: string; text?: string } | undefined
      const message = data?.message ?? eventName
      if (eventName === "assistant.delta") {
        const delta =
          typeof data?.message === "string"
            ? data.message
            : typeof data?.text === "string"
              ? data.text
              : message
        if (delta) {
          receivedDelta = true
          assistantText += delta
          assistantUpdater.set(escapeHtml(assistantText))
        }
        return
      }

      if (eventName === "assistant.message") {
        if (receivedDelta) return
        const text =
          typeof data?.message === "string"
            ? data.message
            : typeof data?.text === "string"
              ? data.text
              : message
        if (text) {
          assistantText = text
          assistantUpdater.set(escapeHtml(assistantText))
        }
        return
      }

      if (eventName === "assistant.thinking") {
        const text =
          typeof data?.message === "string"
            ? data.message
            : typeof data?.text === "string"
              ? data.text
              : message
        if (text) {
          void options.botApi.sendMessage(
            options.chatId,
            `<blockquote expandable>${escapeHtml(`Thinking: ${text}`)}</blockquote>`,
            { parse_mode: "HTML" },
          )
        }
        return
      }

      if (eventName === "tool.executed") {
        const label = formatToolLabel(message)
        toolUpdater.set(`Tool: ${escapeHtml(label)}`)
        return
      }

      if (eventName === "run.completed") {
        completed = true
        options.onTerminal?.(eventName)
        controller.abort()
        return
      }

      if (eventName === "run.failed") {
        failedText = normalizeRunMessage(message, "Run failed:")
        if (failedText) {
          assistantUpdater.set(escapeHtml(failedText))
        }
        completed = true
        options.onTerminal?.(eventName)
        controller.abort()
        return
      }

      if (eventName === "run.canceled") {
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
    await toolUpdater.close()
    await assistantUpdater.close()
  }
}
