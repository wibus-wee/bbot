import { Elysia } from "elysia"

import { config } from "../config"

export const authGuard = new Elysia({ name: "auth" }).onBeforeHandle(
  ({ headers, set, path }) => {
    if (path.startsWith("/health") || path.startsWith("/openapi")) {
      return
    }

    if (!config.coreApiToken) {
      return
    }

    const authorization = headers.authorization
    const expected = `Bearer ${config.coreApiToken}`
    if (!authorization || authorization !== expected) {
      set.status = 401
      return { error: "Unauthorized" }
    }
  },
)
