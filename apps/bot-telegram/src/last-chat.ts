import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

import { consola } from "consola"

import { resolveLastChatPath } from "@bbot/shared"

const LAST_CHAT_PATH = resolveLastChatPath()
const WRITE_THROTTLE_MS = 3000

let lastChatId: number | null = null
let lastWriteAt = 0

export const recordLastChat = async (chatId: number) => {
  const now = Date.now()
  if (lastChatId === chatId && now - lastWriteAt < WRITE_THROTTLE_MS) return

  lastChatId = chatId
  lastWriteAt = now

  const payload = {
    chatId,
    updatedAt: new Date(now).toISOString(),
  }

  try {
    await mkdir(dirname(LAST_CHAT_PATH), { recursive: true })
    await writeFile(LAST_CHAT_PATH, JSON.stringify(payload), "utf8")
  } catch (error) {
    consola.warn({ error }, "Failed to persist last chat id")
  }
}
