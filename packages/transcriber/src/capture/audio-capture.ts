import { ScreenCaptureKit, type NativeAudioSample } from '../native-loader';
import { AudioSource } from '../types';
import { AudioSourceBase, type CaptureOptions } from './audio-source';

export interface ApplicationInfo {
  readonly processId: number;
  readonly bundleIdentifier: string;
  readonly applicationName: string;
}

/**
 * System audio capture source. Uses ScreenCaptureKit to capture the audio
 * played by a single application. Independent from the microphone source.
 */
export class AudioCapture extends AudioSourceBase {
  protected readonly source = AudioSource.SYSTEM_AUDIO;

  private readonly native: InstanceType<typeof ScreenCaptureKit>;

  constructor() {
    super();
    this.native = new ScreenCaptureKit();
  }

  getApplications(): ApplicationInfo[] {
    return this.native.getAvailableApps().filter((app) => {
      return app.applicationName.trim().length > 0 && app.bundleIdentifier.trim().length > 0;
    });
  }

  getAudioApps(): ApplicationInfo[] {
    return this.getApplications().filter((app) => {
      const name = app.applicationName.toLowerCase();
      const excluded = [
        'finder',
        'system settings',
        'activity monitor',
        'terminal',
        'iterm',
        'dock',
        'control center',
      ];
      return !excluded.some((value) => name.includes(value));
    });
  }

  /**
   * Select a single application to capture audio from.
   *
   * Returns the first application matching any hint. When `fallbackToFirst`
   * is false (the default), it returns `null` instead of silently routing
   * from an arbitrary application, so audio is never captured from an
   * unintended app.
   */
  selectApp(hints: readonly string[], fallbackToFirst = false): ApplicationInfo | null {
    const apps = this.getAudioApps();

    for (const hint of hints) {
      const search = hint.toLowerCase();
      const match = apps.find((app) => {
        return (
          app.applicationName.toLowerCase().includes(search) ||
          app.bundleIdentifier.toLowerCase().includes(search)
        );
      });

      if (match) {
        return match;
      }
    }

    return fallbackToFirst ? apps[0] ?? null : null;
  }

  startCapture(processId: number, options: CaptureOptions = {}): boolean {
    return this.start(options, processId);
  }

  stopCapture(): void {
    this.stop();
  }

  protected startNative(
    options: CaptureOptions,
    onSample: (sample: NativeAudioSample) => void,
    processId?: number
  ): boolean {
    if (processId === undefined) {
      throw new Error('System audio capture requires a processId');
    }

    return this.native.startCapture(
      processId,
      {
        sampleRate: options.sampleRate ?? 48_000,
        channels: options.channels ?? 2,
        bufferSize: options.bufferSize,
      },
      onSample
    );
  }

  protected stopNative(): void {
    this.native.stopCapture();
  }
}
