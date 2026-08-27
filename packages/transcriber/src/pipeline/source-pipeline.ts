import { EventEmitter } from 'events';
import type { AudioSource, TimestampedAudioFrame } from '../types';
import { AudioConverter } from './audio-converter';
import { AudioChunker } from './audio-chunker';
import { BoundedAudioQueue } from './bounded-audio-queue';
import { VoiceActivityDetector } from './voice-activity-detector';
import type { SttWebSocketClient } from '../transport/stt-websocket-client';

export interface SourcePipelineOptions {
  readonly source: AudioSource;
  readonly outputSampleRate: number;
  readonly outputChannels: 1;
  readonly chunkSizeBytes: number;
  readonly queueMaxBytes: number;
  readonly vadEnabled: boolean;
  readonly vadThreshold: number;
  readonly wsClient: SttWebSocketClient;
}

/**
 * Per-source audio processing chain.
 *
 * One instance exists per audio source (microphone, system audio). It owns
 * the bounded queue, converter, VAD, chunker, and forwards chunks to the
 * shared STT WebSocket client tagged with the source. Keeping sources in
 * separate pipelines preserves the conversation timeline.
 */
export class SourcePipeline extends EventEmitter {
  private readonly source: AudioSource;
  private readonly converter: AudioConverter;
  private readonly chunker: AudioChunker;
  private readonly queue: BoundedAudioQueue;
  private readonly vad: VoiceActivityDetector | null;
  private readonly wsClient: SttWebSocketClient;
  private processorPromise: Promise<void> | null = null;
  private running = false;

  getSource(): AudioSource {
    return this.source;
  }

  constructor(options: SourcePipelineOptions) {
    super();
    this.source = options.source;
    this.converter = new AudioConverter(options.outputSampleRate, options.outputChannels);
    this.chunker = new AudioChunker(options.chunkSizeBytes);
    this.queue = new BoundedAudioQueue(options.queueMaxBytes);
    this.vad = options.vadEnabled ? new VoiceActivityDetector(options.vadThreshold) : null;
    this.wsClient = options.wsClient;
  }

  push(frame: TimestampedAudioFrame): void {
    this.queue.push(frame);
    this.emit('queue-updated', this.queue.sizeBytes(), this.queue.droppedCount());
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.processorPromise = this.runProcessor();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.queue.close();

    if (this.processorPromise) {
      await this.processorPromise;
      this.processorPromise = null;
    }

    const remainder = this.chunker.flushRemainder();
    if (remainder && remainder.byteLength > 0) {
      this.wsClient.sendAudio({
        payload: remainder,
        captureTimestampMs: Date.now(),
        source: this.source,
      });
    }

    this.converter.dispose();
  }

  private async runProcessor(): Promise<void> {
    while (this.running) {
      const frame = await this.queue.pop();
      if (!frame) break;

      try {
        const pcm16 = await this.converter.convert(frame);

        if (this.vad && !this.vad.hasSpeech(pcm16)) {
          continue;
        }

        const chunks = this.chunker.push(pcm16);

        for (const chunk of chunks) {
          const queued = this.wsClient.sendAudio({
            payload: chunk,
            captureTimestampMs: frame.captureTimestampMs,
            source: this.source,
          });
          if (!queued) {
            this.emit('chunk-dropped');
          }
        }
      } catch (error) {
        this.emit('conversion-error', error);
      }
    }
  }
}
