// UI-side contracts mirroring @roofle/shared. Kept local so the UI package
// does not need to depend on the Node-only shared build.

export type QuestionStatus = 'open' | 'answered' | 'stale';

export interface QuestionEvent {
  readonly sessionId: string;
  readonly source: string;
  readonly id: number;
  readonly question: string;
  readonly status: QuestionStatus;
}

export interface SessionSummary {
  readonly sessionId: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly questionCount: number;
}

export interface SessionQuestion {
  readonly id: number;
  readonly question: string;
  readonly status: QuestionStatus;
  readonly source: string;
  readonly createdAt: string;
}

export interface SessionDetail {
  readonly sessionId: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly transcription: string;
  readonly questions: SessionQuestion[];
}

export type AppStatus =
  | 'starting'
  | 'loading-model'
  | 'ready'
  | 'capturing'
  | 'error'
  | 'stopped';

export interface SttMessage {
  readonly type: 'partial' | 'final' | 'ready' | 'error';
  readonly text?: string;
  readonly source?: string;
  readonly message?: string;
}
