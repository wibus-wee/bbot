import type Database from "better-sqlite3";

import type { ContextView } from "./views/context-view";

const CONTEXT_VIEW_NAME = "context_view";

export interface ProjectionState {
  view: ContextView;
  cursor: number;
}

export class ProjectionStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  loadContextView(): ProjectionState {
    const viewRow = this.db
      .prepare("SELECT payload_json FROM context_views WHERE name = ?")
      .get(CONTEXT_VIEW_NAME) as { payload_json: string } | undefined;

    const cursorRow = this.db
      .prepare("SELECT cursor_seq FROM projections WHERE name = ?")
      .get(CONTEXT_VIEW_NAME) as { cursor_seq: number } | undefined;

    const view = viewRow
      ? (JSON.parse(viewRow.payload_json) as ContextView)
      : {
          updatedAt: new Date().toISOString(),
          inboundMessages: [],
          actions: [],
        };

    return {
      view,
      cursor: cursorRow?.cursor_seq ?? 0,
    };
  }

  saveContextView(view: ContextView, cursor: number): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO context_views (name, payload_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at"
      )
      .run(CONTEXT_VIEW_NAME, JSON.stringify(view), now);

    this.db
      .prepare(
        "INSERT INTO projections (name, cursor_seq, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET cursor_seq = excluded.cursor_seq, updated_at = excluded.updated_at"
      )
      .run(CONTEXT_VIEW_NAME, cursor, now);
  }
}
