import Database from "better-sqlite3";

export interface DbConfig {
  path: string;
}

export const openDb = (config: DbConfig): Database.Database => {
  const db = new Database(config.path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
};
