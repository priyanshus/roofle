import type { SessionDetail, SessionQuestion, SessionSummary } from '@roofle/shared';
import type { DatabaseSync } from 'node:sqlite';

interface SessionRow {
  readonly id: string;
  readonly started_at: string;
  readonly updated_at: string;
  readonly question_count: number;
}

interface ParagraphRow {
  readonly text: string;
}

interface QuestionDetailRow {
  readonly id: number;
  readonly question: string;
  readonly status: string;
  readonly source: string;
  readonly created_at: string;
  readonly reason: string | null;
}

// Persists and queries conversation sessions and their transcription.
export class SessionRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  // Registers a session on first ingest and bumps its activity timestamp.
  touchSession(sessionId: string): void {
    this.db
      .prepare(`
        INSERT INTO sessions (id, updated_at)
        VALUES (?, datetime('now'))
        ON CONFLICT (id) DO UPDATE SET updated_at = datetime('now')
      `)
      .run(sessionId);
  }

  // Lists all sessions, most recently active first, with question counts.
  getSessions(): SessionSummary[] {
    const rows = this.db
      .prepare(`
        SELECT
          s.id,
          s.started_at,
          s.updated_at,
          (SELECT COUNT(*) FROM questions q WHERE q.session_id = s.id) AS question_count
        FROM sessions s
        ORDER BY s.updated_at DESC
      `)
      .all() as SessionRow[];

    return rows.map((row) => ({
      sessionId: row.id,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      questionCount: row.question_count,
    }));
  }

  // Returns the full transcription and questions for one session.
  getSession(sessionId: string): SessionDetail | null {
    const session = this.db
      .prepare(`SELECT id, started_at, updated_at FROM sessions WHERE id = ?`)
      .get(sessionId) as { id: string; started_at: string; updated_at: string } | undefined;

    if (!session) {
      return null;
    }

    const paragraphs = this.db
      .prepare(`
        SELECT text FROM paragraphs
        WHERE session_id = ?
        ORDER BY start ASC
      `)
      .all(sessionId) as ParagraphRow[];

    const questions = this.db
      .prepare(`
        SELECT id, question, status, source, created_at, reason
        FROM questions
        WHERE session_id = ?
        ORDER BY id ASC
      `)
      .all(sessionId) as QuestionDetailRow[];

    return {
      sessionId: session.id,
      startedAt: session.started_at,
      updatedAt: session.updated_at,
      transcription: paragraphs.map((p) => p.text).join('\n\n'),
      questions: questions.map((q) => ({
        id: q.id,
        question: q.question,
        status: q.status as SessionQuestion['status'],
        source: q.source ?? '',
        createdAt: q.created_at,
        reason: q.reason ?? undefined,
      })),
    };
  }
}
