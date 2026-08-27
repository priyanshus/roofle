import { ConverterType, create as createResampler } from '@alexanderolsen/libsamplerate-js';
import type { TimestampedAudioFrame } from '../types';

type Resampler = Awaited<ReturnType<typeof createResampler>>;

export class AudioConverter {
  private readonly outputSampleRate: number;
  private readonly outputChannels: 1;
  private resampler: Resampler | null = null;
  private currentInputRate: number | null = null;

  constructor(outputSampleRate: number, outputChannels: 1) {
    this.outputSampleRate = outputSampleRate;
    this.outputChannels = outputChannels;
  }

  async convert(frame: TimestampedAudioFrame): Promise<Buffer> {
    const monoFloat = this.toMonoFloat32(frame);

    if (frame.sampleRate !== this.currentInputRate || this.resampler === null) {
      await this.resetResampler(frame.sampleRate);
    }

    const resampled = this.resampler ? this.resampler.full(monoFloat) : monoFloat;
    return this.float32ToInt16Buffer(resampled);
  }

  dispose(): void {
    if (this.resampler) {
      this.resampler.destroy();
      this.resampler = null;
      this.currentInputRate = null;
    }
  }

  private async resetResampler(inputSampleRate: number): Promise<void> {
    if (this.resampler) {
      this.resampler.destroy();
      this.resampler = null;
    }

    this.resampler = await createResampler(this.outputChannels, inputSampleRate, this.outputSampleRate, {
      converterType: ConverterType.SRC_SINC_MEDIUM_QUALITY,
    });

    this.currentInputRate = inputSampleRate;
  }

  private toMonoFloat32(frame: TimestampedAudioFrame): Float32Array {
    const mono = this.toFloat32(frame);

    if (frame.channels === 1) {
      return mono;
    }

    if (frame.channels !== 2) {
      throw new Error(`Unsupported channel count: ${frame.channels}`);
    }

    const framesCount = mono.length / 2;
    const downmixed = new Float32Array(framesCount);

    for (let i = 0; i < framesCount; i += 1) {
      downmixed[i] = (mono[i * 2] + mono[i * 2 + 1]) * 0.5;
    }

    return downmixed;
  }

  private toFloat32(frame: TimestampedAudioFrame): Float32Array {
    if (frame.format === 'float32') {
      return new Float32Array(
        frame.data.buffer,
        frame.data.byteOffset,
        frame.data.byteLength / Float32Array.BYTES_PER_ELEMENT
      );
    }

    const input = new Int16Array(
      frame.data.buffer,
      frame.data.byteOffset,
      frame.data.byteLength / Int16Array.BYTES_PER_ELEMENT
    );

    const output = new Float32Array(input.length);

    for (let i = 0; i < input.length; i += 1) {
      output[i] = input[i] / 32768;
    }

    return output;
  }

  private float32ToInt16Buffer(samples: Float32Array): Buffer {
    const int16 = new Int16Array(samples.length);

    for (let i = 0; i < samples.length; i += 1) {
      const clamped = Math.max(-1, Math.min(1, samples[i]));
      int16[i] = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
    }

    return Buffer.from(int16.buffer, int16.byteOffset, int16.byteLength);
  }
}
