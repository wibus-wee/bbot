import { openapi } from "@elysiajs/openapi"
import { Elysia } from "elysia"

export const openapiPlugin = new Elysia({ name: "openapi" }).use(
  openapi({
    documentation: {
      info: {
        title: "BBot Core API",
        version: "0.1.0",
      },
    },
  }),
)
