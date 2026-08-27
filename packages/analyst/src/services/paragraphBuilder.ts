import type { Paragraph, TranscriptionEvent } from '@roofle/shared';

class SessionState {
  private readonly sessionId: string;
  private readonly source: string;
  private readonly onUpdate: (paragraph: Paragraph) => void;
  private readonly buffer: TranscriptionEvent[] = [];
  private nextExpectedSeq: number | null = null;
  private readonly pending = new Map<number, TranscriptionEvent>();

  constructor(sessionId: string, source: string, onUpdate: (paragraph: Paragraph) => void) {
    this.sessionId = sessionId;
    this.source = source;
    this.onUpdate = onUpdate;
  }

  add(transcription: TranscriptionEvent): void {
    if (this.nextExpectedSeq === null) {
      this.nextExpectedSeq = transcription.sequence;
    }

    if (transcription.sequence === this.nextExpectedSeq) {
      this.append(transcription);
      this.drainPending();
      this.emit();
      return;
    }

    // Out of order or a gap: hold it and re-process when the next stream arrives.
    this.pending.set(transcription.sequence, transcription);
  }

  private append(transcription: TranscriptionEvent): void {
    this.buffer.push(transcription);
    this.nextExpectedSeq = transcription.sequence + 1;
  }

  private drainPending(): void {
    while (this.pending.has(this.nextExpectedSeq ?? -1)) {
      const next = this.pending.get(this.nextExpectedSeq ?? -1);
      if (!next) break;
      this.pending.delete(this.nextExpectedSeq ?? -1);
      this.append(next);
    }
  }

  private emit(): void {
    if (this.buffer.length === 0) {
      return;
    }

    const paragraph: Paragraph = {
      sessionId: this.sessionId,
      source: this.source,
      text: this.buffer.map((t) => t.text).join(' '),
      start: this.buffer[0].start,
      end: this.buffer[this.buffer.length - 1].end,
      streamCount: this.buffer.length,
    };

    this.onUpdate(paragraph);
  }
}

export class ParagraphBuilder {
  private readonly onUpdate: (paragraph: Paragraph) => void;
  private readonly sessions = new Map<string, SessionState>();

  constructor(options: { onUpdate: (paragraph: Paragraph) => void }) {
    this.onUpdate = options.onUpdate;
  }

  add(transcription: TranscriptionEvent): void {
    const key = this.key(transcription);
    const state = this.getOrCreateSession(key, transcription);

    state.add(transcription);
  }

  private key(transcription: TranscriptionEvent): string {
    return `${transcription.sessionId}:${transcription.source}`;
  }

  private getOrCreateSession(key: string, transcription: TranscriptionEvent): SessionState {
    if (!this.sessions.has(key)) {
      this.sessions.set(
        key,
        new SessionState(transcription.sessionId, transcription.source, this.onUpdate)
      );
    }

    return this.sessions.get(key) as SessionState;
  }
}
