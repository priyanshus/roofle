import type { DatabaseSync } from 'node:sqlite';

interface SummaryRow {
  readonly summary: string;
}

// Persists the rolling conversation summary per session. A single summary is
// updated in place each analysis run (summary = summarize(prev + delta)).
export class SummaryRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  upsertSummary(sessionId: string, summary: string): void {
    this.db
      .prepare(`
        INSERT INTO session_summaries (session_id, summary, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT (session_id) DO UPDATE SET
          summary = excluded.summary,
          updated_at = excluded.updated_at
      `)
      .run(sessionId, summary);
  }

  // Returns the stored rolling summary for a session, or null when none.
  getSummary(sessionId: string): string | null {
    const row = this.db
      .prepare(`SELECT summary FROM session_summaries WHERE session_id = ?`)
      .get(sessionId) as SummaryRow | undefined;

    return row?.summary ?? null;
  }

  // Returns the stored one-line title for a session, or null when none.
  getTitle(sessionId: string): string | null {
    const row = this.db
      .prepare(`SELECT title FROM session_summaries WHERE session_id = ?`)
      .get(sessionId) as { title: string | null } | undefined;

    return row?.title ?? null;
  }

  // Persists the generated one-line title for a session. A title is always
  // derived from a stored summary, so this is a pure UPDATE on an existing
  // session_summaries row.
  setTitle(sessionId: string, title: string): void {
    this.db
      .prepare(`
        UPDATE session_summaries
        SET title = ?, updated_at = datetime('now')
        WHERE session_id = ?
      `)
      .run(title, sessionId);
  }
}
