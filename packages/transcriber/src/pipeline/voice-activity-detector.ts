/**
 * Voice Activity Detector.
 *
 * Computes the RMS energy of a PCM16 buffer and reports whether it contains
 * speech. The purpose is to avoid sending silence to the transcription
 * service, reducing load and latency.
 */
export class VoiceActivityDetector {
  private readonly threshold: number;

  constructor(threshold: number) {
    if (!Number.isFinite(threshold) || threshold < 0) {
      throw new Error('threshold must be a non-negative number');
    }
    this.threshold = threshold;
  }

  /**
   * Returns true when the PCM16 buffer's RMS energy is at or above the
   * configured threshold. An empty buffer is treated as silence.
   */
  hasSpeech(pcm16: Buffer): boolean {
    if (pcm16.byteLength === 0) {
      return false;
    }

    const samples = new Int16Array(
      pcm16.buffer,
      pcm16.byteOffset,
      pcm16.byteLength / Int16Array.BYTES_PER_ELEMENT
    );

    let sumSquares = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const normalized = samples[i] / 32768;
      sumSquares += normalized * normalized;
    }

    const rms = Math.sqrt(sumSquares / samples.length);
    return rms >= this.threshold;
  }
}
