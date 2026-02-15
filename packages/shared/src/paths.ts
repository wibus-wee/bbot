import { resolve } from "node:path"

export const resolveRepoRoot = () => resolve(__dirname, "..", "..", "..")

export const resolveRestartScript = () =>
  resolve(resolveRepoRoot(), "tooling", "restart", "index.ts")

export const resolveSessionStatePath = () =>
  resolve(resolveRepoRoot(), ".bbot", "session-state.json")
