import type { DatabaseSync } from 'node:sqlite';

interface QuestionRow {
  readonly id: number;
  readonly question: string;
}

// Persists and queries the clarifying questions surfaced for a session.
export class QuestionRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
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
}
