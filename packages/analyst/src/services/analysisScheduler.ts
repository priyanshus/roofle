import type { Paragraph } from '@roofle/shared';
import type { AnalysisConfig } from '../config.js';
import type { SqliteClient } from '../db/index.js';
import { AnalysisWorker } from './analysisWorker.js';
import type { ParagraphAnalyst } from './paragraphAnalyst.js';
import { SessionState, type SessionScheduler } from './sessionState.js';

const SOURCE_MICROPHONE = 'microphone';
const SOURCE_SYSTEM = 'system';

// Human-readable labels so the LLM can tell which transcription is the other
// party's speech and which is the user's own microphone voice.
const LABEL_MICROPHONE = 'Microphone (your own voice)';
const LABEL_SYSTEM = 'Speaker (the other party)';

// Shown to the agents when the microphone source has no captured text yet, so
// they don't assume the user's voice was recorded.
const NO_MICROPHONE_CAPTURED = 'No Microphone Captured';

export interface ResolvedQuestion {
  id: number;
  reason: string;
}

export interface SchedulerUpdate {
  sessionId: string;
  source: string;
  newQuestions: { id: number; question: string }[];
  answered: ResolvedQuestion[];
  stale: ResolvedQuestion[];
}

// Owns one SessionState per (sessionId, source) and a shared worker queue.
export class AnalysisScheduler implements SessionScheduler {
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

  // Returns the other source's accumulated transcription plus its label, so
  // the agents can tell which voice it is and avoid re-asking what the user
  // has already said. When the other source is the microphone and has no text
  // yet, surface that explicitly so the agents don't assume it was captured.
  getContext(sessionId: string, source: string): { context: string; contextLabel: string } {
    const other = source === SOURCE_MICROPHONE ? SOURCE_SYSTEM : SOURCE_MICROPHONE;
    const text = this.db.getParagraphText(sessionId, other) ?? '';
    const context =
      other === SOURCE_MICROPHONE && !text.trim() ? NO_MICROPHONE_CAPTURED : text;
    return {
      context,
      contextLabel: this.getLabel(other),
    };
  }

  // Maps a raw source id to a human-readable label for the LLM prompt.
  getLabel(source: string): string {
    return source === SOURCE_MICROPHONE ? LABEL_MICROPHONE : LABEL_SYSTEM;
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
      result: { questions: string[]; answered: ResolvedQuestion[]; stale: ResolvedQuestion[] };
    };
    this.sessions.get(key)?.onResult(analysisResult);
  }

  // Clears all in-memory per-session state so a new session id starts clean.
  reset(): void {
    for (const session of this.sessions.values()) {
      session.dispose();
    }
    this.sessions.clear();
  }

  dispose(): void {
    this.reset();
  }
}
