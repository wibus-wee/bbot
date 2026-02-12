import { jsonb, pgEnum, pgTable, text, varchar } from "drizzle-orm/pg-core"

import { createdAt, idGenerator, timestamps, timestamptz, updatedAt } from "./_helpers"

export const workspaceSessionStatus = pgEnum("workspace_session_status", [
  "active",
  "archived",
])

export const runStatus = pgEnum("run_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
])

export const runEventType = pgEnum("run_event_type", [
  "run.queued",
  "run.started",
  "run.progress",
  "run.completed",
  "run.failed",
  "tool.executed",
])

export const userMessageKind = pgEnum("user_message_kind", [
  "info",
  "progress",
  "result",
  "tool",
  "error",
])

export const toolExecutionStatus = pgEnum("tool_execution_status", [
  "succeeded",
  "failed",
])

export const workspaceSessions = pgTable("workspace_sessions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(idGenerator("workspace"))
    .notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  rootPath: text("root_path"),
  status: workspaceSessionStatus("status").default("active").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  ...timestamps,
})

export const runs = pgTable("runs", {
  id: text("id")
    .primaryKey()
    .$defaultFn(idGenerator("run"))
    .notNull(),
  sessionId: text("session_id")
    .references(() => workspaceSessions.id, { onDelete: "cascade" })
    .notNull(),
  prompt: text("prompt").notNull(),
  status: runStatus("status").default("queued").notNull(),
  summary: text("summary"),
  error: text("error"),
  startedAt: timestamptz("started_at"),
  finishedAt: timestamptz("finished_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const runEvents = pgTable("run_events", {
  id: text("id")
    .primaryKey()
    .$defaultFn(idGenerator("event"))
    .notNull(),
  runId: text("run_id")
    .references(() => runs.id, { onDelete: "cascade" })
    .notNull(),
  type: runEventType("type").notNull(),
  message: text("message").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  timestamp: timestamptz("timestamp").defaultNow().notNull(),
})

export const toolExecutions = pgTable("tool_executions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(idGenerator("tool"))
    .notNull(),
  runId: text("run_id")
    .references(() => runs.id, { onDelete: "cascade" })
    .notNull(),
  tool: text("tool").notNull(),
  input: jsonb("input").$type<Record<string, unknown>>().notNull(),
  output: jsonb("output").$type<Record<string, unknown>>().notNull(),
  status: toolExecutionStatus("status").default("succeeded").notNull(),
  error: text("error"),
  startedAt: timestamptz("started_at").defaultNow().notNull(),
  endedAt: timestamptz("ended_at"),
})

export const userMessages = pgTable("user_messages", {
  id: text("id")
    .primaryKey()
    .$defaultFn(idGenerator("msg"))
    .notNull(),
  sessionId: text("session_id")
    .references(() => workspaceSessions.id, { onDelete: "cascade" })
    .notNull(),
  runId: text("run_id").references(() => runs.id, { onDelete: "cascade" }),
  kind: userMessageKind("kind").notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  timestamp: timestamptz("timestamp").defaultNow().notNull(),
})
