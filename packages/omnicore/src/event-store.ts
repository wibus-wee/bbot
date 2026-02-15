import type Database from "better-sqlite3";

import type { Event } from "./events";
import { DEFAULT_SESSION_ID } from "./events";

export interface StoredEvent {
  seq: number;
  event: Event;
}

const toEvent = (row: {
  id: string;
  type: string;
  timestamp: string;
  actor_id: string | null;
  trace_id: string;
  session_id: string | null;
  causation_id: string | null;
  payload_json: string;
}): Event => ({
  id: row.id,
  type: row.type as Event["type"],
  timestamp: row.timestamp,
  actorId: row.actor_id,
  traceId: row.trace_id,
  sessionId: row.session_id ?? DEFAULT_SESSION_ID,
  causationId: row.causation_id ?? undefined,
  payload: JSON.parse(row.payload_json) as Event["payload"],
});

export class SqliteEventStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  append(event: Event): number {
    const info = this.db
      .prepare(
        "INSERT INTO events (id, type, timestamp, actor_id, trace_id, session_id, causation_id, schema_version, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        event.id,
        event.type,
        event.timestamp,
        event.actorId,
        event.traceId,
        event.sessionId,
        event.causationId ?? null,
        1,
        JSON.stringify(event.payload)
      );

    return Number(info.lastInsertRowid);
  }

  getLatestSeq(): number {
    const row = this.db
      .prepare("SELECT seq FROM events ORDER BY seq DESC LIMIT 1")
      .get() as { seq: number } | undefined;
    return row?.seq ?? 0;
  }

  readSince(seq: number, limit?: number): StoredEvent[] {
    const clause = limit ? "LIMIT ?" : "";
    const statement = this.db.prepare(
      `SELECT seq, id, type, timestamp, actor_id, trace_id, session_id, causation_id, payload_json FROM events WHERE seq > ? ORDER BY seq ASC ${clause}`
    );

    const rows = (limit ? statement.all(seq, limit) : statement.all(seq)) as Array<{
      seq: number;
      id: string;
      type: string;
      timestamp: string;
      actor_id: string | null;
      trace_id: string;
      session_id: string | null;
      causation_id: string | null;
      payload_json: string;
    }>;

    return rows.map((row) => ({ seq: row.seq, event: toEvent(row) }));
  }

  readRecent(limit: number): Event[] {
    const rows = this.db
      .prepare(
        "SELECT id, type, timestamp, actor_id, trace_id, session_id, causation_id, payload_json FROM events ORDER BY seq DESC LIMIT ?"
      )
      .all(limit) as Array<{
      id: string;
      type: string;
      timestamp: string;
      actor_id: string | null;
      trace_id: string;
      session_id: string | null;
      causation_id: string | null;
      payload_json: string;
    }>;

    return rows.map(toEvent).reverse();
  }

  readRecentWithSeq(limit: number): StoredEvent[] {
    const rows = this.db
      .prepare(
        "SELECT seq, id, type, timestamp, actor_id, trace_id, session_id, causation_id, payload_json FROM events ORDER BY seq DESC LIMIT ?"
      )
      .all(limit) as Array<{
      seq: number;
      id: string;
      type: string;
      timestamp: string;
      actor_id: string | null;
      trace_id: string;
      session_id: string | null;
      causation_id: string | null;
      payload_json: string;
    }>;

    return rows.map((row) => ({ seq: row.seq, event: toEvent(row) })).reverse();
  }

  tail(
    onEvent: (event: Event) => Promise<void>,
    options: { pollMs?: number; fromEnd?: boolean } = {}
  ): () => void {
    const pollMs = options.pollMs ?? 500;
    let stopped = false;
    let lastSeq = options.fromEnd ? this.getLatestSeq() : 0;

    const poll = async () => {
      if (stopped) {
        return;
      }
      try {
        const rows = this.readSince(lastSeq);
        for (const row of rows) {
          lastSeq = row.seq;
          await onEvent(row.event);
        }
      } catch (error) {
        console.error("[omnicore] event store tail error", error);
      } finally {
        if (!stopped) {
          setTimeout(poll, pollMs);
        }
      }
    };

    setTimeout(poll, pollMs);

    return () => {
      stopped = true;
    };
  }
}
