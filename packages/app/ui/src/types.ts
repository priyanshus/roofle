// UI-side contracts mirroring @roofle/shared. Kept local so the UI package
// does not need to depend on the Node-only shared build.

export type QuestionStatus = 'open' | 'answered' | 'stale';

// Live capture lifecycle pushed by the server.
export type CaptureState = 'stopped' | 'running' | 'paused';

export interface QuestionEvent {
  readonly sessionId: string;
  readonly source: string;
  readonly id: number;
  readonly question: string;
  readonly status: QuestionStatus;
  readonly reason?: string;
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
  readonly reason?: string;
}

export interface SessionDetail {
  readonly sessionId: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly transcription: string;
  readonly questions: SessionQuestion[];
}

export type MeetingAnalysisStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface PersonaContext {
  readonly id: string;
  readonly label: string;
}

export interface Persona {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly contexts: PersonaContext[];
}

export interface MeetingMetric {
  readonly key: string;
  readonly label: string;
  readonly score: number;
  readonly summary: string;
  readonly evidence: string[];
}

export interface MeetingAnalysis {
  readonly sessionId: string;
  readonly status: MeetingAnalysisStatus;
  readonly createdAt: string;
  readonly completedAt?: string;
  readonly error?: string;
  readonly persona?: string;
  readonly personaContext?: string;
  readonly metrics: MeetingMetric[];
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
