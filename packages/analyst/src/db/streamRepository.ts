import type { TranscriptionEvent } from '@roofle/shared';
import type { DatabaseSync } from 'node:sqlite';

// Persists raw transcription segments.
export class StreamRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  insertStream(transcription: TranscriptionEvent): void {
    const stmt = this.db.prepare(`
      INSERT INTO streams (type, text, start, end, source, timestamp_ms, session_id, sequence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      transcription.type,
      transcription.text,
      transcription.start,
      transcription.end,
      transcription.source,
      transcription.timestampMs,
      transcription.sessionId,
      transcription.sequence
    );
  }
}
