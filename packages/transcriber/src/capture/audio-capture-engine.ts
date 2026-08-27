import { EventEmitter } from 'events';
import { AudioSource, type TimestampedAudioFrame } from '../types';
import { AudioCapture, type ApplicationInfo } from './audio-capture';
import { MicrophoneCapture } from './microphone-capture';
import type { AudioSample, CaptureOptions } from './audio-source';

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
  private selectedApp: ApplicationInfo | null = null;

  constructor(options: CaptureEngineOptions) {
    super();
    this.options = options;
    this.system = new AudioCapture();
    this.mic = new MicrophoneCapture();
    this.attachHandlers();
  }

  listApplications(): ApplicationInfo[] {
    return this.system.getAudioApps();
  }

  /**
   * Select and lock a single application for system audio capture. Returns
   * null when no hint matches rather than silently falling back.
   */
  pickApplication(hints: readonly string[]): ApplicationInfo | null {
    this.selectedApp = this.system.selectApp(hints, false);
    return this.selectedApp;
  }

  getSelectedApplication(): ApplicationInfo | null {
    return this.selectedApp;
  }

  start(processId: number): void {
    if (this.options.captureSystemAudio) {
      if (!this.selectedApp) {
        throw new Error('No system audio application selected');
      }
      this.system.startCapture(processId, {
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

export type { AudioSource, TimestampedAudioFrame, CaptureOptions };
