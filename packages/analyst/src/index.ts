import type {
  Paragraph,
  QuestionEvent,
  SessionDetail,
  SessionSummary,
  TranscriptionEvent,
} from '@roofle/shared';
import type { AnalystConfig } from './config.js';
import { SqliteClient } from './db/database.js';
import { ParagraphBuilder } from './services/paragraphBuilder.js';
import { ParagraphAnalyst } from './services/paragraphAnalyst.js';
import { AnalysisScheduler } from './services/analysisScheduler.js';

export interface AnalystOptions {
  config: AnalystConfig;
  dbPath: string;
  onQuestion: (question: QuestionEvent) => void;
}

/**
 * In-process analyst. Replaces the old Kafka consumer + producer: the
 * transcriber calls `ingest()` directly and questions are emitted via the
 * `onQuestion` callback instead of being published to Kafka.
 */
export class Analyst {
  private readonly db: SqliteClient;
  private readonly scheduler: AnalysisScheduler;
  private readonly paragraphBuilder: ParagraphBuilder;

  constructor(options: AnalystOptions) {
    this.db = new SqliteClient(options.dbPath);

    const analyst = new ParagraphAnalyst(options.config.llm);

    this.scheduler = new AnalysisScheduler({
      analyst,
      db: this.db,
      analysisConfig: options.config.analysis,
      onUpdate: (update) => this.handleUpdate(update, options.onQuestion),
    });

    this.paragraphBuilder = new ParagraphBuilder({
      onUpdate: (paragraph) => this.persistParagraph(paragraph),
    });
  }

  // Entry point called by the transcriber for each finalized transcription.
  ingest(transcription: TranscriptionEvent): void {
    this.db.touchSession(transcription.sessionId);
    this.db.insertStream(transcription);
    this.paragraphBuilder.add(transcription);
  }

  // Lists all past conversations, most recently active first.
  getSessions(): SessionSummary[] {
    return this.db.getSessions();
  }

  // Returns the full transcription and questions for one conversation.
  getSession(sessionId: string): SessionDetail | null {
    return this.db.getSession(sessionId);
  }

  private persistParagraph(paragraph: Paragraph): void {
    this.db.upsertParagraph(paragraph);

    // Non-blocking: the scheduler decides when to run the LLM.
    this.scheduler.update(paragraph);
  }

  private handleUpdate(
    update: {
      sessionId: string;
      source: string;
      newQuestions: { id: number; question: string }[];
      answeredIds: number[];
      staleIds: number[];
    },
    onQuestion: (question: QuestionEvent) => void
  ): void {
    const answered = this.db.getQuestionsByIds(update.answeredIds).map((q) => ({
      id: q.id,
      question: q.question,
      status: 'answered' as const,
    }));
    const stale = this.db.getQuestionsByIds(update.staleIds).map((q) => ({
      id: q.id,
      question: q.question,
      status: 'stale' as const,
    }));
    const open = update.newQuestions.map((q) => ({
      id: q.id,
      question: q.question,
      status: 'open' as const,
    }));

    const events = [...open, ...answered, ...stale];

    for (const event of events) {
      onQuestion({
        sessionId: update.sessionId,
        source: update.source,
        id: event.id,
        question: event.question,
        status: event.status,
      });
    }

    console.log(
      `[questions] ${update.sessionId}:${update.source} new=${JSON.stringify(update.newQuestions)} ` +
        `answered=${JSON.stringify(update.answeredIds)} stale=${JSON.stringify(update.staleIds)}`
    );
  }

  dispose(): void {
    this.scheduler.dispose();
    this.db.close();
  }
}
