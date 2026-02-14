import { z } from "zod"

import { dateTimeString } from "./common"

export const systemConfigKeyParams = z.object({
  key: z.string().min(1),
})

export type SystemConfigKeyParams = z.infer<typeof systemConfigKeyParams>

export const systemConfigResponse = z.object({
  id: z.string(),
  key: z.string(),
  value: z.unknown(),
  createdAt: dateTimeString,
  updatedAt: dateTimeString,
})

export const systemConfigListResponse = z.array(systemConfigResponse)

export const upsertSystemConfigBody = z.object({
  value: z.unknown(),
})

export type UpsertSystemConfigBody = z.infer<typeof upsertSystemConfigBody>
