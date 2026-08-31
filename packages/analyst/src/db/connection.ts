import { DatabaseSync } from 'node:sqlite';
import { initSchema } from './schema.js';

// Owns the single SQLite connection shared by all repositories. WAL journaling
// keeps reads non-blocking while the ingest thread writes.
export class Connection {
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    initSchema(this.db);
  }

  close(): void {
    this.db.close();
  }
}
