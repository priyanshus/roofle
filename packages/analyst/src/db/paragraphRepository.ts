import type { Paragraph } from '@roofle/shared';
import type { DatabaseSync } from 'node:sqlite';

interface ParagraphRow {
  readonly text: string;
}

// Persists the accumulated paragraph text per (sessionId, source).
export class ParagraphRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  upsertParagraph(paragraph: Paragraph): void {
    const stmt = this.db.prepare(`
      INSERT INTO paragraphs (session_id, source, text, start, end, stream_count, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT (session_id, source) DO UPDATE SET
        text = excluded.text,
        start = excluded.start,
        end = excluded.end,
        stream_count = excluded.stream_count,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      paragraph.sessionId,
      paragraph.source,
      paragraph.text,
      paragraph.start,
      paragraph.end,
      paragraph.streamCount
    );
  }

  // Returns the accumulated paragraph text for one (sessionId, source), or
  // null when that source has not produced any transcription yet.
  getParagraphText(sessionId: string, source: string): string | null {
    const row = this.db
      .prepare(`SELECT text FROM paragraphs WHERE session_id = ? AND source = ?`)
      .get(sessionId, source) as ParagraphRow | undefined;

    return row?.text ?? null;
  }
}
