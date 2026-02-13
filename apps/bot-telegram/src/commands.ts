export const COMMANDS = [
  {
    command: "start",
    description: "Show welcome message",
  },
  {
    command: "help",
    description: "Show available commands",
  },
  {
    command: "new",
    description: "Create a new workspace session",
  },
  {
    command: "fork",
    description: "Fork the current workspace session",
  },
  {
    command: "resume",
    description: "List or search previous sessions",
  },
  {
    command: "cancel",
    description: "Cancel the active run",
  },
] as const

export type BotCommand = (typeof COMMANDS)[number]
