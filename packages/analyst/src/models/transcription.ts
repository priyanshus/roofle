import type { TranscriptionEvent } from '@roofle/shared';

/** Parses a raw JSON transcription payload into a typed event. */
export function transcriptionFromJson(raw: string): TranscriptionEvent {
  const data = JSON.parse(raw) as TranscriptionEvent;

  return {
    type: data.type,
    text: data.text,
    start: data.start,
    end: data.end,
    source: data.source,
    timestampMs: data.timestampMs,
    sessionId: data.sessionId,
    sequence: data.sequence,
  };
}
