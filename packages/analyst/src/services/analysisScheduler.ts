import type { Paragraph, QuestionEvent } from '@roofle/shared';
import type { AnalysisConfig } from '../config.js';
import type { SqliteClient } from '../db/database.js';
import { AnalysisWorker } from './analysisWorker.js';
import type { ParagraphAnalyst } from './paragraphAnalyst.js';

const STATE_ACCUMULATING = 'accumulating';
const STATE_ANALYZING = 'analyzing';
const STATE_COOLDOWN = 'cooldown';

const STATUS_ANSWERED = 'answered';
const STATUS_STALE = 'stale';

export interface SchedulerUpdate {
  sessionId: string;
  source: string;
  newQuestions: { id: number; question: string }[];
  answeredIds: number[];
  staleIds: number[];
}

// Per-session analysis state machine.
//
//   accumulating --(interval + gates pass)--> analyzing --(done)--> cooldown
//        ^                                                              |
//        +----------------(cooldown elapsed)----------------------------+
//
// The LLM is only called when the paragraph is long enough (minChars) AND has
// grown enough since the last analysis (minNewChars). This bounds cost to at
// most one call per interval per session, and usually far fewer.
class SessionState {
  private readonly key: string;
  private readonly sessionId: string;
  private readonly source: string;
  private readonly scheduler: AnalysisScheduler;
  private state = STATE_ACCUMULATING;
  private text = '';
  private lastAnalyzedLength = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    key: string,
    sessionId: string,
    source: string,
    scheduler: AnalysisScheduler
  ) {
    this.key = key;
    this.sessionId = sessionId;
    this.source = source;
    this.scheduler = scheduler;
  }

  update(text: string): void {
    this.text = text;
    this.ensureTimer();
  }

  private ensureTimer(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => this.tick(), this.scheduler.intervalMs);
    this.timer.unref?.();
  }

  private tick(): void {
    if (this.state !== STATE_ACCUMULATING) {
      return;
    }

    if (!this.passesGates()) {
      return;
    }

    this.state = STATE_ANALYZING;
    this.scheduler.worker.enqueue({
      execute: async () => {
        const delta = this.text.substring(this.lastAnalyzedLength);
        const openQuestions = this.scheduler.db.getOpenQuestions(this.sessionId, this.source);
        const result = await this.scheduler.analyst.analyze(delta, openQuestions);
        return { key: this.key, result };
      },
    });
  }

  private passesGates(): boolean {
    const { minChars, minNewChars } = this.scheduler;

    if (this.text.length < minChars) {
      return false;
    }

    const newChars = this.text.length - this.lastAnalyzedLength;
    return newChars >= minNewChars;
  }

  onResult(result: {
    questions: string[];
    answeredIds: number[];
    staleIds: number[];
  }): void {
    this.lastAnalyzedLength = this.text.length;

    const { questions, answeredIds, staleIds } = result;

    for (const id of answeredIds) {
      this.scheduler.db.updateQuestionStatus(id, STATUS_ANSWERED);
    }
    for (const id of staleIds) {
      this.scheduler.db.updateQuestionStatus(id, STATUS_STALE);
    }

    const newIds = this.scheduler.db.insertQuestions(this.sessionId, this.source, questions);

    this.scheduler.onUpdate({
      sessionId: this.sessionId,
      source: this.source,
      newQuestions: questions.map((question, i) => ({ id: newIds[i], question })),
      answeredIds,
      staleIds,
    });

    this.state = STATE_COOLDOWN;

    setTimeout(() => {
      this.state = STATE_ACCUMULATING;
    }, this.scheduler.cooldownMs);
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

// Owns one SessionState per (sessionId, source) and a shared worker queue.
export class AnalysisScheduler {
  readonly intervalMs: number;
  readonly minChars: number;
  readonly minNewChars: number;
  readonly cooldownMs: number;
  readonly worker: AnalysisWorker;
  readonly db: SqliteClient;
  readonly analyst: ParagraphAnalyst;
  readonly onUpdate: (update: SchedulerUpdate) => void;
  private readonly sessions = new Map<string, SessionState>();

  constructor(options: {
    analyst: ParagraphAnalyst;
    db: SqliteClient;
    analysisConfig: AnalysisConfig;
    onUpdate: (update: SchedulerUpdate) => void;
  }) {
    this.analyst = options.analyst;
    this.db = options.db;
    this.intervalMs = options.analysisConfig.intervalMs;
    this.minChars = options.analysisConfig.minChars;
    this.minNewChars = options.analysisConfig.minNewChars;
    this.cooldownMs = options.analysisConfig.cooldownMs;
    this.onUpdate = options.onUpdate;

    this.worker = new AnalysisWorker({
      concurrency: options.analysisConfig.concurrency,
      maxRetries: options.analysisConfig.maxRetries,
      onResult: (result) => this.handleResult(result),
    });
  }

  // Called on every paragraph update. Non-blocking.
  update(paragraph: Paragraph): void {
    const key = this.key(paragraph);
    const session = this.getOrCreate(key, paragraph);
    session.update(paragraph.text);
  }

  private key(paragraph: Paragraph): string {
    return `${paragraph.sessionId}:${paragraph.source}`;
  }

  private getOrCreate(key: string, paragraph: Paragraph): SessionState {
    if (!this.sessions.has(key)) {
      this.sessions.set(
        key,
        new SessionState(key, paragraph.sessionId, paragraph.source, this)
      );
    }
    return this.sessions.get(key) as SessionState;
  }

  private handleResult(result: unknown): void {
    const { key, result: analysisResult } = result as {
      key: string;
      result: { questions: string[]; answeredIds: number[]; staleIds: number[] };
    };
    this.sessions.get(key)?.onResult(analysisResult);
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      session.dispose();
    }
    this.sessions.clear();
  }
}

export type { QuestionEvent };
