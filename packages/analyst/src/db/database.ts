import { DatabaseSync } from 'node:sqlite';
import type {
  MeetingAnalysis,
  Paragraph,
  SessionDetail,
  SessionQuestion,
  SessionSummary,
  TranscriptionEvent,
} from '@roofle/shared';

interface QuestionRow {
  readonly id: number;
  readonly question: string;
}

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
}

interface MeetingAnalysisRow {
  readonly session_id: string;
  readonly status: string;
  readonly result: string | null;
  readonly created_at: string;
  readonly completed_at: string | null;
  readonly persona: string | null;
  readonly persona_context: string | null;
}

/** SQLite persistence for streams, paragraphs, and questions. */
export class SqliteClient {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.init();
  }

  private init(): void {
    this.db.exec(`
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

    this.migrate();
  }

  // Adds columns introduced after the table was first created. SQLite has no
  // "ADD COLUMN IF NOT EXISTS", so probe the schema and patch when missing.
  private migrate(): void {
    const questionCols = this.db
      .prepare(`PRAGMA table_info(questions)`)
      .all()
      .map((c) => (c as { name: string }).name);

    if (!questionCols.includes('status')) {
      this.db.exec(`ALTER TABLE questions ADD COLUMN status TEXT NOT NULL DEFAULT 'open'`);
    }

    const meetingCols = this.db
      .prepare(`PRAGMA table_info(meeting_analyses)`)
      .all()
      .map((c) => (c as { name: string }).name);

    if (!meetingCols.includes('persona')) {
      this.db.exec(`ALTER TABLE meeting_analyses ADD COLUMN persona TEXT`);
    }
    if (!meetingCols.includes('persona_context')) {
      this.db.exec(`ALTER TABLE meeting_analyses ADD COLUMN persona_context TEXT`);
    }
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

  insertQuestions(sessionId: string, source: string, questions: string[]): number[] {
    const stmt = this.db.prepare(`
      INSERT INTO questions (session_id, source, question)
      VALUES (?, ?, ?)
    `);

    const ids: number[] = [];
    for (const question of questions) {
      const { lastInsertRowid } = stmt.run(sessionId, source, question);
      ids.push(Number(lastInsertRowid));
    }

    return ids;
  }

  // Returns open questions for a session, oldest first, so the resolver can
  // check whether new content has answered them.
  getOpenQuestions(sessionId: string, source: string): QuestionRow[] {
    return this.db
      .prepare(`
        SELECT id, question
        FROM questions
        WHERE session_id = ? AND source = ? AND status = 'open'
        ORDER BY id ASC
      `)
      .all(sessionId, source) as QuestionRow[];
  }

  // Returns question text for the given ids, so resolved questions can be
  // published with their content.
  getQuestionsByIds(ids: number[]): QuestionRow[] {
    if (ids.length === 0) {
      return [];
    }

    const placeholders = ids.map(() => '?').join(',');
    return this.db
      .prepare(`SELECT id, question FROM questions WHERE id IN (${placeholders})`)
      .all(...ids) as QuestionRow[];
  }

  // One-way transition: open -> answered/stale. Never re-opens a question.
  updateQuestionStatus(id: number, status: string): void {
    this.db.prepare(`UPDATE questions SET status = ? WHERE id = ?`).run(status, id);
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
        SELECT id, question, status, source, created_at
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
      })),
    };
  }

  // Registers a meeting analysis run for a session + persona, or returns the
  // existing one. A session may be analysed once per persona+context; a repeat
  // request for the same persona returns the stored row.
  ensureMeetingAnalysis(
    sessionId: string,
    persona?: string,
    personaContext?: string
  ): MeetingAnalysis {
    const existing = this.getMeetingAnalysis(sessionId, persona, personaContext);
    if (existing) {
      return existing;
    }

    this.db
      .prepare(`
        INSERT INTO meeting_analyses (session_id, status, persona, persona_context)
        VALUES (?, 'pending', ?, ?)
      `)
      .run(sessionId, persona ?? null, personaContext ?? null);

    return {
      sessionId,
      status: 'pending',
      createdAt: new Date().toISOString(),
      persona,
      personaContext,
      metrics: [],
      turns: [],
      recommendations: [],
    };
  }

  // Returns the stored meeting analysis for a session + persona, or null when
  // none. Without a persona, matches the generic (persona-less) analysis.
  getMeetingAnalysis(
    sessionId: string,
    persona?: string,
    personaContext?: string
  ): MeetingAnalysis | null {
    const row = this.db
      .prepare(`
        SELECT * FROM meeting_analyses
        WHERE session_id = ? AND persona IS ? AND persona_context IS ?
      `)
      .get(sessionId, persona ?? null, personaContext ?? null) as
      | MeetingAnalysisRow
      | undefined;

    if (!row) {
      return null;
    }

    return this.mapMeetingAnalysis(row);
  }

  // Lists all meeting analyses, most recently created first.
  getMeetingAnalyses(): MeetingAnalysis[] {
    const rows = this.db
      .prepare(`SELECT * FROM meeting_analyses ORDER BY created_at DESC`)
      .all() as MeetingAnalysisRow[];

    return rows.map((row) => this.mapMeetingAnalysis(row));
  }

  // Marks a meeting analysis as running.
  markMeetingAnalysisRunning(
    sessionId: string,
    persona?: string,
    personaContext?: string
  ): void {
    this.db
      .prepare(`
        UPDATE meeting_analyses
        SET status = 'running'
        WHERE session_id = ? AND persona IS ? AND persona_context IS ?
      `)
      .run(sessionId, persona ?? null, personaContext ?? null);
  }

  // Persists a completed meeting analysis result.
  saveMeetingAnalysisResult(
    sessionId: string,
    result: Omit<MeetingAnalysis, 'sessionId' | 'status' | 'createdAt'>
  ): void {
    const payload = JSON.stringify({
      summary: result.summary,
      metrics: result.metrics,
      turns: result.turns,
      recommendations: result.recommendations,
    });

    this.db
      .prepare(`
        UPDATE meeting_analyses
        SET status = 'completed', result = ?, completed_at = datetime('now')
        WHERE session_id = ? AND persona IS ? AND persona_context IS ?
      `)
      .run(payload, sessionId, result.persona ?? null, result.personaContext ?? null);
  }

  // Marks a meeting analysis as failed with an error message.
  failMeetingAnalysis(
    sessionId: string,
    error: string,
    persona?: string,
    personaContext?: string
  ): void {
    this.db
      .prepare(`
        UPDATE meeting_analyses
        SET status = 'failed', result = ?, completed_at = datetime('now')
        WHERE session_id = ? AND persona IS ? AND persona_context IS ?
      `)
      .run(JSON.stringify({ error }), sessionId, persona ?? null, personaContext ?? null);
  }

  private mapMeetingAnalysis(row: MeetingAnalysisRow): MeetingAnalysis {
    const parsed = row.result ? (JSON.parse(row.result) as Record<string, unknown>) : {};

    return {
      sessionId: row.session_id,
      status: row.status as MeetingAnalysis['status'],
      createdAt: row.created_at,
      completedAt: row.completed_at ?? undefined,
      error: typeof parsed.error === 'string' ? parsed.error : undefined,
      persona: row.persona ?? undefined,
      personaContext: row.persona_context ?? undefined,
      summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
      metrics: Array.isArray(parsed.metrics) ? (parsed.metrics as MeetingAnalysis['metrics']) : [],
      turns: Array.isArray(parsed.turns) ? (parsed.turns as MeetingAnalysis['turns']) : [],
      recommendations: Array.isArray(parsed.recommendations)
        ? (parsed.recommendations as string[])
        : [],
    };
  }

  close(): void {
    this.db.close();
  }
}
