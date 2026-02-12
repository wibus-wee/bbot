import { openapi } from "@elysiajs/openapi"
import { Elysia } from "elysia"
import { z } from "zod"

export const openapiPlugin = new Elysia({ name: "openapi" }).use(
  openapi({
    mapJsonSchema: {
      zod: (schema) => z.toJSONSchema(schema),
    },
    documentation: {
      info: {
        title: "BBot Core API",
        version: "0.1.0",
      },
    },
  }),
)
