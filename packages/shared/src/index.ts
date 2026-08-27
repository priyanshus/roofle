/**
 * Shared typed contracts between the transcriber, analyst, and Electron app.
 * Single source of truth for the in-process event bus and the IPC bridge.
 */

/** Identifies which physical input produced an utterance. */
export enum AudioSource {
  MICROPHONE = 'microphone',
  SYSTEM_AUDIO = 'system',
}

/** A finalized transcription segment flowing from transcriber to analyst. */
export interface TranscriptionEvent {
  readonly type: 'final';
  readonly sessionId: string;
  readonly sequence: number;
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly source: string;
  readonly timestampMs: number;
}

/** Lifecycle of a question surfaced by the analyst. */
export type QuestionStatus = 'open' | 'answered' | 'stale';

/** A question event flowing from analyst to the UI. */
export interface QuestionEvent {
  readonly sessionId: string;
  readonly source: string;
  readonly id: number;
  readonly question: string;
  readonly status: QuestionStatus;
}

/** A live (still-updating) transcription segment for the subtitle UI. */
export interface PartialSttMessage {
  readonly type: 'partial';
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly source: string;
}

/** A finalized transcription segment from the STT server. */
export interface FinalSttMessage {
  readonly type: 'final';
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly source: string;
}

/** STT server readiness notification. */
export interface ReadySttMessage {
  readonly type: 'ready';
  readonly model: string;
  readonly sampleRate: number;
}

/** STT server error notification. */
export interface ErrorSttMessage {
  readonly type: 'error';
  readonly message: string;
}

/** Any message emitted by the STT server. */
export type SttMessage =
  | PartialSttMessage
  | FinalSttMessage
  | ReadySttMessage
  | ErrorSttMessage;

/** A paragraph built by the analyst, keyed by (sessionId, source). */
export interface Paragraph {
  readonly sessionId: string;
  readonly source: string;
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly streamCount: number;
}

/** Events the Electron main process forwards to the renderer. */
export interface UiEventMap {
  stt: { readonly message: SttMessage; readonly latencyMs?: number; readonly source: string };
  question: { readonly question: QuestionEvent };
  status: { readonly state: AppStatus; readonly detail?: string };
}

/** High-level app lifecycle state surfaced to the UI. */
export type AppStatus =
  | 'starting'
  | 'loading-model'
  | 'ready'
  | 'capturing'
  | 'error'
  | 'stopped';

/** A past conversation listed in the library. */
export interface SessionSummary {
  readonly sessionId: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly questionCount: number;
}

/** A question persisted for a session. */
export interface SessionQuestion {
  readonly id: number;
  readonly question: string;
  readonly status: QuestionStatus;
  readonly source: string;
  readonly createdAt: string;
}

/** Full detail for a single session: transcription + questions. */
export interface SessionDetail {
  readonly sessionId: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly transcription: string;
  readonly questions: SessionQuestion[];
}
