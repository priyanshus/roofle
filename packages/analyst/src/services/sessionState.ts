import type { SqliteClient } from '../db/index.js';
import type { AnalysisWorker } from './analysisWorker.js';
import type { ParagraphAnalyst } from './paragraphAnalyst.js';

const STATE_ACCUMULATING = 'accumulating';
const STATE_ANALYZING = 'analyzing';
const STATE_COOLDOWN = 'cooldown';

const STATUS_ANSWERED = 'answered';
const STATUS_STALE = 'stale';

// The slice of the scheduler the state machine needs. Kept as an interface so
// SessionState owns only its own concern (the per-session state machine).
export interface SessionScheduler {
  readonly intervalMs: number;
  readonly minChars: number;
  readonly minNewChars: number;
  readonly cooldownMs: number;
  readonly worker: AnalysisWorker;
  readonly db: SqliteClient;
  readonly analyst: ParagraphAnalyst;
  readonly onUpdate: (update: {
    sessionId: string;
    source: string;
    newQuestions: { id: number; question: string }[];
    answeredIds: number[];
    staleIds: number[];
  }) => void;
  getContext(sessionId: string, source: string): { context: string; contextLabel: string };
  getLabel(source: string): string;
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
export class SessionState {
  private readonly key: string;
  private readonly sessionId: string;
  private readonly source: string;
  private readonly scheduler: SessionScheduler;
  private state = STATE_ACCUMULATING;
  private text = '';
  private lastAnalyzedLength = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(key: string, sessionId: string, source: string, scheduler: SessionScheduler) {
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
        const { context, contextLabel } = this.scheduler.getContext(this.sessionId, this.source);
        const sourceLabel = this.scheduler.getLabel(this.source);
        const result = await this.scheduler.analyst.analyze(
          delta,
          sourceLabel,
          context,
          contextLabel,
          openQuestions
        );
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
