import { t } from "elysia"

export const idParams = t.Object({
  id: t.String({ minLength: 1 }),
})

export type IdParams = typeof idParams.static

export const dateTimeString = t.String({ format: "date-time" })

export const errorResponse = t.Object({
  error: t.String(),
})
