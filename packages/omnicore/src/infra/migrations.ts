import { promises as fs } from "fs";
import path from "path";

import type Database from "better-sqlite3";

export interface Migration {
  id: string;
  upPath: string;
  downPath: string;
}

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "migrations");

const ensureMigrationsTable = (db: Database.Database) => {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
  );
};

const listMigrations = async (): Promise<Migration[]> => {
  const entries = await fs.readdir(MIGRATIONS_DIR);
  const ups = entries.filter((entry) => entry.endsWith(".up.sql"));
  const migrations = ups
    .map((file) => {
      const id = file.replace(".up.sql", "");
      return {
        id,
        upPath: path.join(MIGRATIONS_DIR, file),
        downPath: path.join(MIGRATIONS_DIR, `${id}.down.sql`),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  return migrations;
};

const loadSql = async (filePath: string): Promise<string> => {
  const contents = await fs.readFile(filePath, "utf-8");
  return contents.trim();
};

export const runMigrations = async (db: Database.Database): Promise<void> => {
  ensureMigrationsTable(db);

  const applied = db
    .prepare("SELECT id FROM schema_migrations ORDER BY id")
    .all() as Array<{ id: string }>;
  const appliedIds = applied.map((row) => row.id);

  const migrations = await listMigrations();

  for (const migration of migrations) {
    if (appliedIds.includes(migration.id)) {
      continue;
    }
    const sql = await loadSql(migration.upPath);
    const transaction = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(
        migration.id,
        new Date().toISOString()
      );
    });
    transaction();
  }
};
