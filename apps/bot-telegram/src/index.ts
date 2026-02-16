import { randomUUID } from "crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

import { AdapterClient, createEvent, createTraceId, resolveOmnicoreDataDir } from "@bbot/omnicore"
import { createLogger, loadEnv } from "@bbot/shared"
import { z } from "zod"

type TelegramApiResponse<T> = {
  ok: boolean
  result: T
  description?: string
  error_code?: number
}

type TelegramUpdate = {
  update_id: number
  message?: TelegramMessage
}

type TelegramMessage = {
  message_id: number
  date: number
  text?: string
  chat: TelegramChat
  from?: TelegramUser
}

type TelegramChat = {
  id: number
  type: string
  title?: string
  username?: string
  first_name?: string
  last_name?: string
}

type TelegramUser = {
  id: number
  is_bot: boolean
  first_name: string
  username?: string
  last_name?: string
}

type SessionStore = {
  version: 1
  sessions: Record<string, string>
}

const env = loadEnv(
  z.object({
    BOT_TOKEN: z.string().min(1),
    BOT_TELEGRAM_ALLOWED_USER_IDS: z.string().optional(),
    OMNICORE_ADAPTER_URL: z.string().optional(),
    OMNICORE_ADAPTER_ID: z.string().optional(),
    OMNICORE_DATA_DIR: z.string().optional(),
    OMNICORE_ROOT: z.string().optional(),
  }),
)

const adapterId = env.OMNICORE_ADAPTER_ID ?? "telegram"
const adapterUrl = env.OMNICORE_ADAPTER_URL ?? "ws://localhost:8787"
const apiBaseUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}`

const logger = createLogger({ name: "bot-telegram" })

const dataDir = resolveOmnicoreDataDir()
const sessionsPath = path.join(dataDir, "telegram-sessions.json")

const client = new AdapterClient({
  adapterId,
  url: adapterUrl,
  capabilities: ["send_message", "send_status", "event_in"],
  onAction: async (data) => {
    if (data.action.type === "send_message") {
      const chatId = parseChatId(data.action.actorId)
      if (!chatId) {
        logger.warn({ actorId: data.action.actorId }, "[bot-telegram] invalid actor id")
        return
      }
      await sendMessage(chatId, data.action.text)
    }
    if (data.action.type === "send_status") {
      const chatId = parseChatId(data.action.actorId)
      if (!chatId) {
        return
      }
      if (data.action.status.kind === "thinking" && data.action.status.phase === "start") {
        await sendChatAction(chatId, "typing")
      }
    }
  },
  onOpen: () => {
    logger.info("[bot-telegram] adapter connected")
  },
  onReconnect: (delay) => {
    logger.info({ delayMs: delay }, "[bot-telegram] adapter disconnected, reconnecting")
  },
  onError: (error) => {
    logger.error({ error }, "[bot-telegram] adapter error")
  },
})

const HELP_TEXT = [
  "Commands:",
  "/start - show help",
  "/help - show help",
  "/session - show current session id",
  "/new - create a new session",
  "/use <sessionId> - switch to an existing session",
].join("\n")

const POLL_TIMEOUT_SECONDS = 30
const POLL_LIMIT = 50
const MAX_RETRY_DELAY_MS = 15000
const INITIAL_RETRY_DELAY_MS = 1000
const MAX_MESSAGE_LENGTH = 4000

let sessionStore: SessionStore | null = null
let writeQueue = Promise.resolve()
let shuttingDown = false
let currentAbort: AbortController | null = null

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const ensureDataDir = async () => {
  await mkdir(dataDir, { recursive: true })
}

const createSessionId = () => `session:${randomUUID()}`

const parseAllowedUserIds = (raw: string | undefined): Set<number> | null => {
  if (!raw) {
    return null
  }
  const ids = raw
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value))
  if (ids.length === 0) {
    return null
  }
  return new Set(ids)
}

const allowedUserIds = parseAllowedUserIds(env.BOT_TELEGRAM_ALLOWED_USER_IDS)

const isAllowedUser = (userId: number | undefined) => {
  if (!allowedUserIds) {
    return true
  }
  if (!userId) {
    return false
  }
  return allowedUserIds.has(userId)
}

const parseChatId = (actorId: string): number | null => {
  const parts = actorId.split(":")
  if (parts.length < 2) {
    return null
  }
  const chatId = Number(parts.slice(1).join(":"))
  if (!Number.isFinite(chatId)) {
    return null
  }
  return chatId
}

const loadSessionStore = async (): Promise<SessionStore> => {
  try {
    const raw = await readFile(sessionsPath, "utf-8")
    const data = JSON.parse(raw) as SessionStore
    if (!data || typeof data !== "object" || data.version !== 1 || !data.sessions) {
      throw new Error("invalid session store")
    }
    return data
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return { version: 1, sessions: {} }
    }
    await backupCorruptStore()
    return { version: 1, sessions: {} }
  }
}

const isErrnoException = (error: unknown): error is NodeJS.ErrnoException => {
  return typeof error === "object" && error !== null && "code" in error
}

const backupCorruptStore = async () => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const backupPath = sessionsPath.replace(/\.json$/, `.corrupt-${timestamp}.json`)
    await rename(sessionsPath, backupPath)
  } catch (error) {
    logger.error({ error }, "[bot-telegram] failed to backup session store")
  }
}

const persistSessionStore = async (store: SessionStore) => {
  const tempPath = `${sessionsPath}.tmp`
  const payload = `${JSON.stringify(store, null, 2)}\n`
  writeQueue = writeQueue
    .then(async () => {
      await writeFile(tempPath, payload, "utf-8")
      await rename(tempPath, sessionsPath)
    })
    .catch((error) => {
      logger.error({ error }, "[bot-telegram] failed to persist session store")
    })
  return writeQueue
}

const getSessionStore = () => {
  if (!sessionStore) {
    throw new Error("session store not loaded")
  }
  return sessionStore
}

const ensureSessionForChat = async (message: TelegramMessage) => {
  const store = getSessionStore()
  const chatKey = String(message.chat.id)
  const existing = store.sessions[chatKey]
  if (existing) {
    return existing
  }
  const sessionId = createSessionId()
  store.sessions[chatKey] = sessionId
  await persistSessionStore(store)
  emitSessionCreated(sessionId, message)
  return sessionId
}

const createNewSession = async (message: TelegramMessage) => {
  const store = getSessionStore()
  const chatKey = String(message.chat.id)
  const sessionId = createSessionId()
  store.sessions[chatKey] = sessionId
  await persistSessionStore(store)
  emitSessionCreated(sessionId, message)
  return sessionId
}

const emitSessionCreated = (sessionId: string, message: TelegramMessage) => {
  const event = createEvent({
    type: "session.created",
    actorId: String(message.chat.id),
    traceId: createTraceId(),
    sessionId,
    payload: {
      metadata: {
        chatId: message.chat.id,
        chatType: message.chat.type,
        fromId: message.from?.id,
        fromUsername: message.from?.username,
      },
    },
  })
  client.sendEvent(event)
}

const normalizeSessionId = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) {
    return ""
  }
  if (trimmed.startsWith("session:")) {
    return trimmed
  }
  return `session:${trimmed}`
}

const handleCommand = async (message: TelegramMessage, text: string) => {
  const [commandRaw = "", ...rest] = text.trim().split(" ")
  const [command] = commandRaw.split("@")
  const args = rest.join(" ").trim()
  const chatId = message.chat.id

  if (command === "/start" || command === "/help") {
    const currentSession = getSessionStore().sessions[String(chatId)]
    const sessionText = currentSession
      ? `Current session: ${currentSession}`
      : "No session yet. Use /new to create one."
    await sendMessage(chatId, `${HELP_TEXT}\n\n${sessionText}`)
    return
  }

  if (command === "/session") {
    const currentSession = getSessionStore().sessions[String(chatId)]
    const sessionText = currentSession
      ? `Current session: ${currentSession}`
      : "No session yet. Use /new to create one."
    await sendMessage(chatId, sessionText)
    return
  }

  if (command === "/new") {
    const sessionId = await createNewSession(message)
    await sendMessage(chatId, `New session: ${sessionId}`)
    return
  }

  if (command === "/use") {
    const sessionId = normalizeSessionId(args)
    if (!sessionId) {
      await sendMessage(chatId, "Usage: /use <sessionId>")
      return
    }
    const store = getSessionStore()
    store.sessions[String(chatId)] = sessionId
    await persistSessionStore(store)
    await sendMessage(chatId, `Session set to ${sessionId}`)
    return
  }

  await sendMessage(chatId, "Unknown command. Use /help.")
}

const handleMessage = async (message: TelegramMessage) => {
  if (!message.text) {
    return
  }

  if (!isAllowedUser(message.from?.id)) {
    await sendMessage(message.chat.id, "Not authorized")
    return
  }

  if (message.text.startsWith("/")) {
    await handleCommand(message, message.text)
    return
  }

  const sessionId = await ensureSessionForChat(message)
  const event = createEvent({
    type: "signal.inbound",
    actorId: String(message.chat.id),
    traceId: createTraceId(),
    sessionId,
    payload: {
      kind: "message",
      text: message.text,
      metadata: {
        chatId: message.chat.id,
        chatType: message.chat.type,
        messageId: message.message_id,
        fromId: message.from?.id,
        fromUsername: message.from?.username,
      },
    },
  })
  client.sendEvent(event)
}

const fetchUpdates = async (offset: number, signal: AbortSignal) => {
  const url = new URL(`${apiBaseUrl}/getUpdates`)
  url.searchParams.set("timeout", String(POLL_TIMEOUT_SECONDS))
  url.searchParams.set("limit", String(POLL_LIMIT))
  if (offset > 0) {
    url.searchParams.set("offset", String(offset))
  }

  const response = await fetch(url, { signal })
  if (!response.ok) {
    logger.error(
      { status: response.status, statusText: response.statusText },
      "[bot-telegram] getUpdates failed",
    )
    return null
  }

  const payload = (await response.json()) as TelegramApiResponse<TelegramUpdate[]>
  if (!payload.ok) {
    logger.error(
      { errorCode: payload.error_code, description: payload.description },
      "[bot-telegram] getUpdates error",
    )
    return null
  }

  return payload.result
}

const sendTelegram = async <T>(method: string, body: Record<string, unknown>) => {
  const response = await fetch(`${apiBaseUrl}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    logger.error(
      { method, status: response.status, statusText: response.statusText },
      "[bot-telegram] request failed",
    )
    return null
  }

  const payload = (await response.json()) as TelegramApiResponse<T>
  if (!payload.ok) {
    logger.error(
      { method, errorCode: payload.error_code, description: payload.description },
      "[bot-telegram] request error",
    )
    return null
  }

  return payload.result
}

const splitMessage = (text: string) => {
  if (text.length <= MAX_MESSAGE_LENGTH) {
    return [text]
  }
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > MAX_MESSAGE_LENGTH) {
    let slice = remaining.slice(0, MAX_MESSAGE_LENGTH)
    const lastBreak = slice.lastIndexOf("\n")
    if (lastBreak > 0) {
      slice = slice.slice(0, lastBreak)
    }
    chunks.push(slice)
    remaining = remaining.slice(slice.length)
    if (remaining.startsWith("\n")) {
      remaining = remaining.slice(1)
    }
  }
  if (remaining.length > 0) {
    chunks.push(remaining)
  }
  return chunks
}

const sendMessage = async (chatId: number, text: string) => {
  const chunks = splitMessage(text)
  for (const chunk of chunks) {
    await sendTelegram("sendMessage", {
      chat_id: chatId,
      text: chunk,
    })
  }
}

const sendChatAction = async (chatId: number, action: "typing") => {
  await sendTelegram("sendChatAction", {
    chat_id: chatId,
    action,
  })
}

const pollLoop = async () => {
  let offset = 0
  let retryDelay = INITIAL_RETRY_DELAY_MS

  while (!shuttingDown) {
    const controller = new AbortController()
    currentAbort = controller
    try {
      const updates = await fetchUpdates(offset, controller.signal)
      if (!updates) {
        await delay(retryDelay)
        retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS)
        continue
      }
      retryDelay = INITIAL_RETRY_DELAY_MS
      for (const update of updates) {
        if (update.update_id >= offset) {
          offset = update.update_id + 1
        }
        if (update.message) {
          await handleMessage(update.message)
        }
      }
    } catch (error) {
      if (shuttingDown) {
        return
      }
      if (error instanceof Error && error.name === "AbortError") {
        continue
      }
      logger.error({ error }, "[bot-telegram] poll error")
      await delay(retryDelay)
      retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS)
    }
  }
}

const start = async () => {
  await ensureDataDir()
  sessionStore = await loadSessionStore()
  client.connect()
  await pollLoop()
}

const stop = () => {
  if (shuttingDown) {
    return
  }
  shuttingDown = true
  currentAbort?.abort()
  client.disconnect()
}

process.on("SIGINT", stop)
process.on("SIGTERM", stop)

start().catch((error) => {
  logger.error({ error }, "[bot-telegram] fatal error")
  process.exit(1)
})
