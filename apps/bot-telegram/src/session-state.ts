export type ActiveRunState = {
  runId: string
  chatId: number
  sessionId: string
  startedAt: string
}

type SessionStateSnapshot = {
  chatSessions: Array<{ chatId: number; sessionId: string }>
  activeRuns: ActiveRunState[]
}

export const initializeSessionState = async (): Promise<SessionStateSnapshot> => ({
  chatSessions: [],
  activeRuns: [],
})

export const recordChatSession = async (_chatId: number, _sessionId: string) => {
  return
}

export const clearChatSessionState = async (_chatId: number) => {
  return
}

export const recordActiveRun = async (_input: {
  runId: string
  chatId: number
  sessionId: string
  startedAt?: string
}) => {
  return
}

export const clearActiveRunsById = async (_runIds: string[]) => {
  return
}
