import type { TimestampedAudioFrame } from '../types';

export interface EchoSuppressorOptions {
  readonly enabled: boolean;
  /** RMS threshold above which the speaker (system audio) is considered active. */
  readonly threshold: number;
  /**
   * How long (ms) the mic stays muted after the speaker goes silent. Prevents
   * rapid toggling on brief gaps in the speaker's audio.
   */
  readonly hangoverMs: number;
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  readonly now?: () => number;
}

/**
 * Half-duplex echo gate.
 *
 * When system audio (the speaker) is producing sound, the microphone is
 * suppressed so the speaker's audio isn't re-transcribed as the user's mic
 * (echo). When the speaker is silent, the mic is allowed through so the user
 * can be heard.
 *
 * This is a simple energy-based gate, not a full AEC (acoustic echo
 * cancellation). It works well for the common case where the user talks only
 * when the speaker is quiet.
 */
export class EchoSuppressor {
  private readonly options: EchoSuppressorOptions;
  private readonly now: () => number;
  private speakerActive = false;
  private lastSpeakerActiveAt = 0;

  constructor(options: EchoSuppressorOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  /**
   * Feed a system-audio frame to update the speaker-activity state. Call this
   * for every system-audio frame before deciding whether to pass mic frames.
   */
  updateSystem(frame: TimestampedAudioFrame): void {
    if (!this.options.enabled) return;
    if (rms(frame.data) >= this.options.threshold) {
      this.speakerActive = true;
      this.lastSpeakerActiveAt = this.now();
    }
  }

  /**
   * Whether a microphone frame should be passed through to transcription.
   * Returns false (suppress) while the speaker is active, and for the hangover
   * window after the speaker goes silent.
   */
  shouldPassMic(): boolean {
    if (!this.options.enabled) return true;
    if (!this.speakerActive) return true;

    if (this.now() - this.lastSpeakerActiveAt > this.options.hangoverMs) {
      this.speakerActive = false;
      return true;
    }
    return false;
  }

  isSpeakerActive(): boolean {
    return this.speakerActive;
  }
}

/** Compute the RMS of a float32 audio buffer. */
function rms(data: Buffer): number {
  if (data.byteLength === 0) return 0;
  const samples = new Float32Array(
    data.buffer,
    data.byteOffset,
    data.byteLength / Float32Array.BYTES_PER_ELEMENT
  );
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i];
    sumSquares += v * v;
  }
  return Math.sqrt(sumSquares / samples.length);
}
