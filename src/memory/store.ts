import Database from "better-sqlite3";

export interface StoredMessage {
  role: string;
  content: string;
  at: number;
}

export class MemoryStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS project_notes (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  appendMessage(role: string, content: string): void {
    this.db.prepare("INSERT INTO messages (role, content, at) VALUES (?, ?, ?)").run(role, content, Date.now());
  }

  recentMessages(limit: number): StoredMessage[] {
    const rows = this.db
      .prepare("SELECT role, content, at FROM messages ORDER BY id DESC LIMIT ?")
      .all(limit) as StoredMessage[];
    return rows.reverse();
  }

  setProjectNote(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO project_notes (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }

  getProjectNote(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM project_notes WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  close(): void {
    this.db.close();
  }
}
