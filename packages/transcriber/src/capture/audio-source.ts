import { EventEmitter } from 'events';
import type { NativeAudioSample } from '../native-loader';
import type { AudioSource, TimestampedAudioFrame } from '../types';

export interface CaptureOptions {
  readonly sampleRate?: number;
  readonly channels?: 1 | 2;
  readonly bufferSize?: number;
}

export interface AudioSample {
  readonly data: Buffer;
  readonly sampleRate: number;
  readonly channels: number;
  readonly timestamp: number;
  readonly format: 'float32';
  readonly sampleCount: number;
  readonly framesCount: number;
  readonly durationMs: number;
  readonly rms: number;
  readonly peak: number;
}

/**
 * Base class for a single native audio input (microphone or system audio).
 *
 * Subclasses own a native capture instance and provide `startNative` /
 * `stopNative`. This base converts each native sample into a timestamped
 * frame tagged with the source, so downstream code never sees Core Audio
 * objects.
 */
export abstract class AudioSourceBase extends EventEmitter {
  private capturing = false;

  protected abstract readonly source: AudioSource;

  protected abstract startNative(
    options: CaptureOptions,
    onSample: (sample: NativeAudioSample) => void,
    processId?: number
  ): boolean;

  protected abstract stopNative(): void;

  start(options: CaptureOptions = {}, processId?: number): boolean {
    if (this.capturing) {
      throw new Error('Capture already running');
    }

    const started = this.startNative(options, (nativeSample) => {
      const sample = this.toAudioSample(nativeSample);
      this.emit('audio', sample);
    }, processId);

    if (!started) {
      return false;
    }

    this.capturing = true;
    this.emit('start');
    return true;
  }

  stop(): void {
    if (!this.capturing) return;
    this.stopNative();
    this.capturing = false;
    this.emit('stop');
  }

  isCapturing(): boolean {
    return this.capturing;
  }

  dispose(): void {
    this.stop();
    this.removeAllListeners();
  }

  /**
   * Wrap a native sample into a timestamped frame. The capture timestamp is
   * taken at the moment the sample reaches Node, which is the closest
   * approximation to wall-clock time available at this boundary.
   */
  toFrame(sample: AudioSample): TimestampedAudioFrame {
    return {
      data: sample.data,
      sampleRate: sample.sampleRate,
      channels: sample.channels,
      format: sample.format,
      source: this.source,
      captureTimestampMs: Date.now(),
      durationMs: sample.durationMs,
    };
  }

  private toAudioSample(nativeSample: NativeAudioSample): AudioSample {
    const floatData = new Float32Array(
      nativeSample.data.buffer,
      nativeSample.data.byteOffset,
      nativeSample.data.byteLength / Float32Array.BYTES_PER_ELEMENT
    );

    let sumSquares = 0;
    let peak = 0;

    for (let i = 0; i < floatData.length; i += 1) {
      const abs = Math.abs(floatData[i]);
      if (abs > peak) peak = abs;
      sumSquares += floatData[i] * floatData[i];
    }

    const rms = floatData.length > 0 ? Math.sqrt(sumSquares / floatData.length) : 0;
    const framesCount =
      nativeSample.channelCount > 0 ? Math.floor(floatData.length / nativeSample.channelCount) : 0;

    return {
      data: nativeSample.data,
      sampleRate: nativeSample.sampleRate,
      channels: nativeSample.channelCount,
      timestamp: nativeSample.timestamp,
      format: 'float32',
      sampleCount: floatData.length,
      framesCount,
      durationMs: nativeSample.sampleRate > 0 ? (framesCount / nativeSample.sampleRate) * 1000 : 0,
      rms,
      peak,
    };
  }
}
