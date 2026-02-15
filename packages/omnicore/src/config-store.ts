import type Database from "better-sqlite3";

export interface KernelSettings {
  heartbeatMs: number;
  modelProvider?: string;
  modelName?: string;
}

export class ConfigStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  getKernelSettings(): KernelSettings {
    const row = this.db
      .prepare(
        "SELECT heartbeat_ms, model_provider, model_name FROM kernel_config WHERE id = 1"
      )
      .get() as
      | {
          heartbeat_ms: number;
          model_provider: string | null;
          model_name: string | null;
        }
      | undefined;

    if (!row) {
      return { heartbeatMs: 60000 };
    }

    return {
      heartbeatMs: row.heartbeat_ms,
      modelProvider: row.model_provider ?? undefined,
      modelName: row.model_name ?? undefined,
    };
  }

  setKernelSettings(input: Partial<KernelSettings>): void {
    const current = this.getKernelSettings();
    const next = {
      heartbeatMs: input.heartbeatMs ?? current.heartbeatMs,
      modelProvider: input.modelProvider ?? current.modelProvider,
      modelName: input.modelName ?? current.modelName,
    };

    this.db
      .prepare(
        "UPDATE kernel_config SET heartbeat_ms = ?, model_provider = ?, model_name = ?, updated_at = ? WHERE id = 1"
      )
      .run(
        next.heartbeatMs,
        next.modelProvider ?? null,
        next.modelName ?? null,
        new Date().toISOString()
      );
  }

  getSecret(key: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM secrets WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSecret(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO secrets (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
      )
      .run(key, value, new Date().toISOString());
  }
}
