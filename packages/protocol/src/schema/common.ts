import { z } from "zod"

export const idParams = z.object({
  id: z.string().min(1),
})

export type IdParams = z.infer<typeof idParams>

export const dateTimeString = z.iso.datetime();

export const errorResponse = z.object({
  error: z.string(),
})

export type ErrorResponse = z.infer<typeof errorResponse>
