import {
  bigserial,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core"

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
  "canceled",
])

export const runEventType = pgEnum("run_event_type", [
  "run.queued",
  "run.started",
  "run.progress",
  "run.completed",
  "run.failed",
  "run.canceled",
  "tool.executed",
])

export const toolExecutionStatus = pgEnum("tool_execution_status", [
  "succeeded",
  "failed",
])

export const sessionEntryKind = pgEnum("session_entry_kind", [
  "message",
  "action",
  "result",
  "summary",
  "system",
])

export const workspaceSessions = pgTable(
  "workspace_sessions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(idGenerator("workspace"))
      .notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    rootPath: text("root_path"),
    telegramChatId: text("telegram_chat_id"),
    telegramUserId: text("telegram_user_id"),
    forkedFromSessionId: text("forked_from_session_id"),
    status: workspaceSessionStatus("status").default("active").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (t) => [
    index("workspace_sessions_chat_user_idx").on(
      t.telegramChatId,
      t.telegramUserId,
    ),
    index("workspace_sessions_forked_from_idx").on(t.forkedFromSessionId),
    foreignKey({
      name: "workspace_sessions_forked_from_session_id_workspace_sessions_id_fk",
      columns: [t.forkedFromSessionId],
      foreignColumns: [t.id],
    }).onDelete("set null"),
  ],
)

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

export const sessionEntries = pgTable(
  "session_entries",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(idGenerator("session"))
      .notNull(),
    sessionId: text("session_id")
      .references(() => workspaceSessions.id, { onDelete: "cascade" })
      .notNull(),
    runId: text("run_id").references(() => runs.id, { onDelete: "cascade" }),
    kind: sessionEntryKind("kind").notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    searchText: text("search_text"),
    sequence: bigserial("sequence", { mode: "number" }).notNull(),
    timestamp: timestamptz("timestamp").defaultNow().notNull(),
  },
  (t) => [
    index("session_entries_session_sequence_idx").on(t.sessionId, t.sequence),
    index("session_entries_run_sequence_idx").on(t.runId, t.sequence),
  ],
)

export const systemConfigs = pgTable(
  "system_configs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(idGenerator("config"))
      .notNull(),
    key: varchar("key", { length: 200 }).notNull(),
    value: jsonb("value").$type<unknown>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("system_configs_key_unique").on(t.key)],
)
