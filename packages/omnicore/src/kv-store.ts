import type Database from "better-sqlite3";

export class KvStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  get(key: string): string | null {
    const row = this.db
      .prepare("SELECT value_json FROM kv_store WHERE key = ?")
      .get(key) as { value_json: string } | undefined;
    return row?.value_json ?? null;
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO kv_store (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at"
      )
      .run(key, value, new Date().toISOString());
  }
}
