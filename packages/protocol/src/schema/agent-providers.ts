import { z } from "zod"

import { dateTimeString } from "./common"

const agentProviderHeaders = z.record(z.string(), z.string()).optional()

export const agentProviderResponse = z.object({
  id: z.string(),
  provider: z.string(),
  model: z.string(),
  baseUrl: z.string().url().optional(),
  headers: agentProviderHeaders,
  apiKeyPreview: z.string().optional(),
  hasApiKey: z.boolean(),
  createdAt: dateTimeString,
  updatedAt: dateTimeString,
})

export const agentProviderListResponse = z.object({
  activeProviderId: z.string().optional(),
  providers: z.array(agentProviderResponse),
})

export const createAgentProviderBody = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  apiKey: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  activate: z.boolean().optional(),
})

export const updateAgentProviderBody = z.object({
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
  baseUrl: z.string().url().nullable().optional(),
  headers: z.record(z.string(), z.string()).nullable().optional(),
})
