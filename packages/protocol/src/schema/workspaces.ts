import { z } from "zod"

import { dateTimeString } from "./common"

export const createWorkspaceBody = z.object({
  name: z.string().min(1),
  rootPath: z.string().optional(),
  telegramChatId: z.string().optional(),
  telegramUserId: z.string().optional(),
  forkedFromSessionId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type CreateWorkspaceBody = z.infer<typeof createWorkspaceBody>

export const workspaceStatus = z.enum(["active", "archived"])

export const workspaceSearchQuery = z.object({
  chatId: z.string().min(1),
  userId: z.string().optional(),
  query: z.string().optional(),
  status: workspaceStatus.optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

export type WorkspaceSearchQuery = z.infer<typeof workspaceSearchQuery>

export const createRunBody = z.object({
  prompt: z.string().min(1),
})

export type CreateRunBody = z.infer<typeof createRunBody>

export const compactWorkspaceBody = z.object({
  keepRecentTokens: z.coerce.number().int().min(0).optional(),
  customInstructions: z.string().min(1).optional(),
})

export type CompactWorkspaceBody = z.infer<typeof compactWorkspaceBody>

export const compactWorkspaceResponse = z.object({
  sessionId: z.string(),
  summary: z.string(),
  didCompact: z.boolean(),
})

export const workspaceResponse = z.object({
  id: z.string(),
  name: z.string(),
  status: workspaceStatus,
  rootPath: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  accessedAt: dateTimeString,
  createdAt: dateTimeString,
  updatedAt: dateTimeString,
})

export const workspaceListResponse = z.array(workspaceResponse)

export const workspaceUsageResponse = z.object({
  sessionId: z.string(),
  model: z
    .object({
      provider: z.string(),
      model: z.string(),
      contextWindow: z.number().int().positive().optional(),
    })
    .optional(),
  context: z.object({
    estimatedTokens: z.number().int().min(0),
    window: z.number().int().positive().optional(),
  }),
  usage: z.object({
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    cacheReadTokens: z.number().int().min(0),
    cacheWriteTokens: z.number().int().min(0),
    totalTokens: z.number().int().min(0),
    cost: z.object({
      input: z.number().min(0),
      output: z.number().min(0),
      cacheRead: z.number().min(0),
      cacheWrite: z.number().min(0),
      total: z.number().min(0),
    }),
  }),
})
