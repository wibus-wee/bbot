import { resolve } from "node:path"

export const resolveRepoRoot = () => resolve(__dirname, "..", "..", "..")

export const resolveRestartScript = () =>
  resolve(resolveRepoRoot(), "tooling", "scripts", "restart-local.sh")

export const resolveRestartReportPath = () =>
  resolve(resolveRepoRoot(), ".bbot", "restart-report.json")

export const resolveLastChatPath = () =>
  resolve(resolveRepoRoot(), ".bbot", "last-chat.json")

export const resolveSessionStatePath = () =>
  resolve(resolveRepoRoot(), ".bbot", "session-state.json")
