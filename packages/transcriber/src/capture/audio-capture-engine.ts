import { EventEmitter } from 'events';
import { AudioSource, type TimestampedAudioFrame } from '../types';
import { AudioCapture } from './audio-capture';
import type { AudioSample, CaptureOptions } from './audio-source';
import { MicrophoneCapture } from './microphone-capture';

export interface CaptureEngineOptions {
  readonly sampleRate: number;
  readonly channels: 1 | 2;
  readonly captureMicrophone: boolean;
  readonly captureSystemAudio: boolean;
}

/**
 * Audio Capture Engine.
 *
 * A thin layer above the two independent capture mechanisms (microphone and
 * system audio). It owns start/stop, source selection, and normalizes every
 * native sample into a timestamped frame tagged with its source.
 *
 * It knows nothing about transcription, LLMs, users, or the UI.
 */
export class AudioCaptureEngine extends EventEmitter {
  private readonly system: AudioCapture;
  private readonly mic: MicrophoneCapture;
  private readonly options: CaptureEngineOptions;

  constructor(options: CaptureEngineOptions) {
    super();
    this.options = options;
    this.system = new AudioCapture();
    this.mic = new MicrophoneCapture();
    this.attachHandlers();
  }

  start(): void {
    if (this.options.captureSystemAudio) {
      // Capture ALL system audio (every app), not a single selected app.
      this.system.startCapture(0, {
        sampleRate: this.options.sampleRate,
        channels: this.options.channels,
      });
    }

    if (this.options.captureMicrophone) {
      this.mic.startCapture({
        sampleRate: this.options.sampleRate,
        channels: 1,
      });
    }
  }

  stop(): void {
    this.system.stopCapture();
    this.mic.stopCapture();
  }

  dispose(): void {
    this.system.dispose();
    this.mic.dispose();
    this.removeAllListeners();
  }

  private attachHandlers(): void {
    this.system.on('audio', (sample: AudioSample) => {
      this.emit('audio', this.system.toFrame(sample));
    });

    this.mic.on('audio', (sample: AudioSample) => {
      this.emit('audio', this.mic.toFrame(sample));
    });

    this.system.on('error', (error: unknown) => {
      this.emit('error', this.toError(error));
    });

    this.mic.on('error', (error: unknown) => {
      this.emit('error', this.toError(error));
    });
  }

  private toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }
}

export type { AudioSource, CaptureOptions, TimestampedAudioFrame };

