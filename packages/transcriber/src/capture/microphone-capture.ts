import { MicrophoneCapture as NativeMic, type NativeAudioSample } from '../native-loader';
import { AudioSource } from '../types';
import { AudioSourceBase, type CaptureOptions } from './audio-source';

/**
 * Microphone capture source. Uses AVAudioEngine (via the native addon) to
 * capture the default input device. Independent from the system audio source.
 */
export class MicrophoneCapture extends AudioSourceBase {
  protected readonly source = AudioSource.MICROPHONE;

  private readonly native: InstanceType<typeof NativeMic>;

  constructor() {
    super();
    this.native = new NativeMic();
  }

  startCapture(options: CaptureOptions = {}): boolean {
    return this.start(options);
  }

  stopCapture(): void {
    this.stop();
  }

  protected startNative(
    options: CaptureOptions,
    onSample: (sample: NativeAudioSample) => void
  ): boolean {
    return this.native.startCapture(
      {
        sampleRate: options.sampleRate ?? 48_000,
        channels: options.channels ?? 1,
        bufferSize: options.bufferSize,
      },
      onSample
    );
  }

  protected stopNative(): void {
    this.native.stopCapture();
  }
}
