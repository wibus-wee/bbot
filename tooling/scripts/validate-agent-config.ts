import { access, readFile } from "node:fs/promises"
import { resolve } from "node:path"

import dotenv from "dotenv"

import { createDatabase } from "@bbot/database"
import { resolveAgentRuntimeConfig } from "../../apps/core-daemon/src/modules/agent-providers/runtime"

const exists = async (path: string) => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const resolveEnvPath = async (args: string[]) => {
  const envFlagIndex = args.indexOf("--env")
  if (envFlagIndex >= 0 && args[envFlagIndex + 1]) {
    return resolve(process.cwd(), args[envFlagIndex + 1])
  }

  const manualPath = args.find((arg) => !arg.startsWith("--"))
  if (manualPath) {
    return resolve(process.cwd(), manualPath)
  }

  const coreEnv = resolve(process.cwd(), "apps", "core-daemon", ".env")
  if (await exists(coreEnv)) return coreEnv

  const rootEnv = resolve(process.cwd(), ".env")
  if (await exists(rootEnv)) return rootEnv

  throw new Error("No env file found. Pass a path or use --env <path>.")
}

const loadEnvFile = async (path: string) => {
  const content = await readFile(path, "utf-8")
  return dotenv.parse(content)
}

const main = async () => {
  const envPath = await resolveEnvPath(process.argv.slice(2))
  const env = await loadEnvFile(envPath)

  const databaseUrl = env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required in the env file")
  }

  const { db, close } = createDatabase(databaseUrl)
  try {
    const config = await resolveAgentRuntimeConfig(db)
    console.info("Agent config validation succeeded.")
    console.info(
      `Active provider: ${config.provider} (${config.model}) baseUrl=${config.baseUrl ?? "-"}`,
    )
    console.info(
      `API key present: ${config.apiKey ? "yes" : "no"} | MCP servers: ${config.mcpServers.length}`,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Agent config validation failed: ${message}`)
    process.exitCode = 1
  } finally {
    await close()
  }
}

void main()
