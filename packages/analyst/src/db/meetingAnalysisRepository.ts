import type { MeetingAnalysis } from '@roofle/shared';
import type { DatabaseSync } from 'node:sqlite';

interface MeetingAnalysisRow {
  readonly session_id: string;
  readonly status: string;
  readonly result: string | null;
  readonly created_at: string;
  readonly completed_at: string | null;
  readonly persona: string | null;
  readonly persona_context: string | null;
}

// Persists and queries the post-hoc meeting report analyses.
export class MeetingAnalysisRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
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
}
