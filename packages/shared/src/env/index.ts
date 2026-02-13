import { existsSync } from "node:fs"
import { resolve } from "node:path"

import dotenv from "dotenv"
import { z } from "zod"

let dotenvLoaded = false

const loadLocalDotenv = (cwd: string) => {
  if (dotenvLoaded) {
    return
  }

  const envPath = resolve(cwd, ".env")
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath })
  }

  dotenvLoaded = true
}

type LoadEnvOptions = {
  cwd?: string
}

export const loadEnv = <T extends z.ZodTypeAny>(
  schema: T,
  options: LoadEnvOptions = {},
): z.infer<T> => {
  loadLocalDotenv(options.cwd ?? process.cwd())
  return schema.parse(process.env)
}

export * from './keys'