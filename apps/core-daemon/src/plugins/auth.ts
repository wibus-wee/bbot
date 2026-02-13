import { bearer } from "@elysiajs/bearer"
import { Elysia } from "elysia"

import { config } from "../config"

const isProduction = config.nodeEnv === "production"

export const authGuard = new Elysia({ name: "auth" })
  .use(bearer())
  .onBeforeHandle(({ bearer, set, path }) => {
    if (path.startsWith("/health") || path.startsWith("/openapi")) {
      return
    }

    if (!config.coreApiToken) {
      if (isProduction) {
        set.status = 500
        return { error: "CORE_API_TOKEN is required" }
      }

      return
    }

    if (!bearer || bearer !== config.coreApiToken) {
      set.status = 401
      set.headers["WWW-Authenticate"] = "Bearer"
      return { error: "Unauthorized" }
    }
  })
