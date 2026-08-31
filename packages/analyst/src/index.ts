import type {
  MeetingAnalysis,
  Paragraph,
  QuestionEvent,
  SessionDetail,
  SessionSummary,
  TranscriptionEvent,
} from '@roofle/shared';
import type { AnalystConfig } from './config.js';
import { SqliteClient } from './db/index.js';
import { AnalysisScheduler } from './services/analysisScheduler.js';
import { MeetingAnalyst } from './services/meetingAnalyst.js';
import { ParagraphAnalyst } from './services/paragraphAnalyst.js';
import { ParagraphBuilder } from './services/paragraphBuilder.js';

export interface AnalystOptions {
  config: AnalystConfig;
  dbPath: string;
  onQuestion: (question: QuestionEvent) => void;
  onMeetingUpdate?: (analysis: MeetingAnalysis) => void;
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
  private readonly meetingAnalyst: MeetingAnalyst;
  private readonly onMeetingUpdate?: (analysis: MeetingAnalysis) => void;

  constructor(options: AnalystOptions) {
    this.db = new SqliteClient(options.dbPath);
    this.onMeetingUpdate = options.onMeetingUpdate;

    const analyst = new ParagraphAnalyst(options.config.llm);
    this.meetingAnalyst = new MeetingAnalyst(options.config.llm);

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

  // Returns the stored meeting analysis for a session + persona, or null when
  // none. Without a persona, matches the generic (persona-less) analysis.
  getMeetingAnalysis(
    sessionId: string,
    persona?: string,
    personaContext?: string
  ): MeetingAnalysis | null {
    return this.db.getMeetingAnalysis(sessionId, persona, personaContext);
  }

  // Lists all meeting analyses, most recently created first.
  getMeetingAnalyses(): MeetingAnalysis[] {
    return this.db.getMeetingAnalyses();
  }

  // Kicks off the agentic meeting analysis for a session + persona. Returns the
  // analysis immediately (pending/running); the result is persisted and emitted
  // via onMeetingUpdate when the agent finishes.
  analyzeMeeting(
    sessionId: string,
    persona?: string,
    personaContext?: string
  ): MeetingAnalysis {
    const analysis = this.db.ensureMeetingAnalysis(sessionId, persona, personaContext);

    if (analysis.status !== 'pending') {
      return analysis;
    }

    this.db.markMeetingAnalysisRunning(sessionId, persona, personaContext);
    this.emitMeetingUpdate({ ...analysis, status: 'running' });

    const session = this.db.getSession(sessionId);
    const transcription = session?.transcription ?? '';

    this.meetingAnalyst
      .analyze(transcription, persona, personaContext)
      .then((result) => {
        this.db.saveMeetingAnalysisResult(sessionId, result);
        this.emitMeetingUpdate(this.db.getMeetingAnalysis(sessionId, persona, personaContext)!);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.db.failMeetingAnalysis(sessionId, message, persona, personaContext);
        this.emitMeetingUpdate(this.db.getMeetingAnalysis(sessionId, persona, personaContext)!);
      });

    return { ...analysis, status: 'running' };
  }

  private emitMeetingUpdate(analysis: MeetingAnalysis): void {
    this.onMeetingUpdate?.(analysis);
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
