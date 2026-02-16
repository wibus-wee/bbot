import type Database from "better-sqlite3";

import type { Event } from "../domain/events";

export type SessionStatus = "active" | "archived";

export interface SessionRecord {
  id: string;
  title: string | null;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  lastEventSeq: number;
  lastEventAt: string;
  summary: string | null;
  archivedAt: string | null;
  rootPath: string | null;
  firstLlmSeq: number | null;
  firstLlmAt: string | null;
}

const SESSION_PROJECTION_NAME = "sessions_projection";

export class SessionStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  loadCursor(): number {
    const row = this.db
      .prepare("SELECT cursor_seq FROM projections WHERE name = ?")
      .get(SESSION_PROJECTION_NAME) as { cursor_seq: number } | undefined;
    return row?.cursor_seq ?? 0;
  }

  saveCursor(cursor: number): void {
    this.db
      .prepare(
        "INSERT INTO projections (name, cursor_seq, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET cursor_seq = excluded.cursor_seq, updated_at = excluded.updated_at"
      )
      .run(SESSION_PROJECTION_NAME, cursor, new Date().toISOString());
  }

  applyEvent(event: Event, seq: number): void {
    const payload = event.payload as Record<string, unknown> | null;
    const title =
      (event.type === "session.created" || event.type === "session.renamed") &&
      typeof payload?.title === "string"
        ? payload.title
        : undefined;
    const rootPath =
      (event.type === "session.root.set" || event.type === "session.created") &&
      typeof payload?.rootPath === "string"
        ? payload.rootPath
        : undefined;
    const summary =
      event.type === "agent.summary" && typeof payload?.summary === "string"
        ? payload.summary
        : undefined;
    const firstLlmSeq = event.type === "agent.run.start" ? seq : undefined;
    const firstLlmAt = event.type === "agent.run.start" ? event.timestamp : undefined;
    const status = event.type === "session.archived" ? "archived" : undefined;
    const archivedAt = event.type === "session.archived" ? event.timestamp : undefined;

    this.db
      .prepare(
        "INSERT OR IGNORE INTO sessions (id, title, status, created_at, updated_at, last_event_seq, last_event_at, summary, archived_at, root_path, first_llm_seq, first_llm_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        event.sessionId,
        title ?? null,
        "active",
        event.timestamp,
        event.timestamp,
        seq,
        event.timestamp,
        summary ?? null,
        archivedAt ?? null,
        rootPath ?? null,
        firstLlmSeq ?? null,
        firstLlmAt ?? null
      );

    this.db
      .prepare(
        "UPDATE sessions SET title = COALESCE(?, title), status = COALESCE(?, status), updated_at = ?, last_event_seq = ?, last_event_at = ?, summary = COALESCE(?, summary), archived_at = COALESCE(?, archived_at), root_path = COALESCE(?, root_path), first_llm_seq = COALESCE(first_llm_seq, ?), first_llm_at = COALESCE(first_llm_at, ?) WHERE id = ?"
      )
      .run(
        title ?? null,
        status ?? null,
        event.timestamp,
        seq,
        event.timestamp,
        summary ?? null,
        archivedAt ?? null,
        rootPath ?? null,
        firstLlmSeq ?? null,
        firstLlmAt ?? null,
        event.sessionId
      );
  }

  listSessions(options: { status?: SessionStatus; limit?: number; offset?: number } = {}): SessionRecord[] {
    const where = options.status ? "WHERE status = ?" : "";
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const sql = `SELECT id, title, status, created_at, updated_at, last_event_seq, last_event_at, summary, archived_at, root_path, first_llm_seq, first_llm_at FROM sessions ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`;

    const rows = (options.status
      ? this.db.prepare(sql).all(options.status, limit, offset)
      : this.db.prepare(sql).all(limit, offset)) as Array<{
      id: string;
      title: string | null;
      status: SessionStatus;
      created_at: string;
      updated_at: string;
      last_event_seq: number;
      last_event_at: string;
      summary: string | null;
      archived_at: string | null;
      root_path: string | null;
      first_llm_seq: number | null;
      first_llm_at: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastEventSeq: row.last_event_seq,
      lastEventAt: row.last_event_at,
      summary: row.summary,
      archivedAt: row.archived_at,
      rootPath: row.root_path,
      firstLlmSeq: row.first_llm_seq,
      firstLlmAt: row.first_llm_at,
    }));
  }

  resetProjection(): void {
    this.db.prepare("DELETE FROM sessions").run();
    this.db.prepare("DELETE FROM projections WHERE name = ?").run(SESSION_PROJECTION_NAME);
  }

  getSession(sessionId: string): SessionRecord | null {
    const row = this.db
      .prepare(
        "SELECT id, title, status, created_at, updated_at, last_event_seq, last_event_at, summary, archived_at, root_path, first_llm_seq, first_llm_at FROM sessions WHERE id = ?"
      )
      .get(sessionId) as {
      id: string;
      title: string | null;
      status: SessionStatus;
      created_at: string;
      updated_at: string;
      last_event_seq: number;
      last_event_at: string;
      summary: string | null;
      archived_at: string | null;
      root_path: string | null;
      first_llm_seq: number | null;
      first_llm_at: string | null;
    } | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      title: row.title,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastEventSeq: row.last_event_seq,
      lastEventAt: row.last_event_at,
      summary: row.summary,
      archivedAt: row.archived_at,
      rootPath: row.root_path,
      firstLlmSeq: row.first_llm_seq,
      firstLlmAt: row.first_llm_at,
    };
  }
}
