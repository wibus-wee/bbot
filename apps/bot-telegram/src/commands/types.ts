import type { Bot } from "grammy"

import type { ApiClient } from "../api"

export type CommandListItem = {
  command: string
  description: string
}

export type CommandContext = {
  bot: Bot
  apiClient: ApiClient
  commandList: CommandListItem[]
  repoRoot: string
  restartScript: string
  ensureAllowed: (userId?: number, chatId?: number) => Promise<boolean>
}

export type CommandModule = {
  command: string
  description: string
  register: (context: CommandContext) => void
}
