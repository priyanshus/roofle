import type { DatabaseSync } from 'node:sqlite';

// Creates all tables and applies additive migrations. SQLite has no
// "ADD COLUMN IF NOT EXISTS", so probe the schema and patch when missing.
export function initSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS streams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      text TEXT NOT NULL,
      start REAL NOT NULL,
      end REAL NOT NULL,
      source TEXT NOT NULL,
      timestamp_ms INTEGER NOT NULL,
      session_id TEXT,
      sequence INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS paragraphs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      source TEXT,
      text TEXT NOT NULL,
      start REAL NOT NULL,
      end REAL NOT NULL,
      stream_count INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (session_id, source)
    );

    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      source TEXT,
      question TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS meeting_analyses (
      session_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      result TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );
  `);

  migrate(db);
}

function migrate(db: DatabaseSync): void {
  const questionCols = db
    .prepare(`PRAGMA table_info(questions)`)
    .all()
    .map((c) => (c as { name: string }).name);

  if (!questionCols.includes('status')) {
    db.exec(`ALTER TABLE questions ADD COLUMN status TEXT NOT NULL DEFAULT 'open'`);
  }

  if (!questionCols.includes('reason')) {
    db.exec(`ALTER TABLE questions ADD COLUMN reason TEXT`);
  }

  const meetingCols = db
    .prepare(`PRAGMA table_info(meeting_analyses)`)
    .all()
    .map((c) => (c as { name: string }).name);

  if (!meetingCols.includes('persona')) {
    db.exec(`ALTER TABLE meeting_analyses ADD COLUMN persona TEXT`);
  }
  if (!meetingCols.includes('persona_context')) {
    db.exec(`ALTER TABLE meeting_analyses ADD COLUMN persona_context TEXT`);
  }
}
