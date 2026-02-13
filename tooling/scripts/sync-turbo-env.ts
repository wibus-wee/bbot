import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

import {
  BOT_TELEGRAM_ENV_KEYS,
  CORE_DAEMON_ENV_KEYS,
} from "../../packages/shared/src/env/keys"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "../..")

const targets = [
  {
    path: "apps/bot-telegram/turbo.json",
    env: [...BOT_TELEGRAM_ENV_KEYS].sort(),
  },
  {
    path: "apps/core-daemon/turbo.json",
    env: [...CORE_DAEMON_ENV_KEYS].sort(),
  },
]

const inputs = ["$TURBO_DEFAULT$", ".env", ".env.*"]

const readJson = (path: string) =>
  JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>

const writeJson = (path: string, data: Record<string, unknown>) => {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)
}

for (const target of targets) {
  const path = resolve(repoRoot, target.path)
  const base = existsSync(path) ? readJson(path) : {}

  const tasks = (base.tasks ?? {}) as Record<string, Record<string, unknown>>
  const dev = { ...(tasks.dev ?? {}) }

  dev.env = target.env
  dev.inputs = inputs

  tasks.dev = dev

  const next = {
    ...base,
    extends: base.extends ?? ["//"],
    tasks,
  }

  writeJson(path, next)
}
