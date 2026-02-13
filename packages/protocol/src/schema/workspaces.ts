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

export const workspaceSearchQuery = z.object({
  chatId: z.string().min(1),
  userId: z.string().optional(),
  query: z.string().optional(),
})

export type WorkspaceSearchQuery = z.infer<typeof workspaceSearchQuery>

export const createRunBody = z.object({
  prompt: z.string().min(1),
})

export type CreateRunBody = z.infer<typeof createRunBody>

export const workspaceStatus = z.enum(["active", "archived"])

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
