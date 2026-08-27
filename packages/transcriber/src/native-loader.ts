import path from 'path';

const nodeGypBuild = require('node-gyp-build') as (dir: string) => any;

let addon: any;

try {
  addon = nodeGypBuild(path.resolve(__dirname, '..'));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(
    `Failed to load native addon. Run \"npm run build:native\" in my-transcriber. Original error: ${message}`
  );
}

export interface NativeAudioSample {
  readonly data: Buffer;
  readonly sampleRate: number;
  readonly channelCount: number;
  readonly timestamp: number;
}

export interface NativeCaptureConfig {
  readonly sampleRate: number;
  readonly channels: number;
  readonly bufferSize?: number;
}

export const ScreenCaptureKit = addon.ScreenCaptureKit as new () => {
  getAvailableApps(): Array<{ processId: number; bundleIdentifier: string; applicationName: string }>;
  startCapture(
    processId: number,
    config: NativeCaptureConfig,
    callback: (sample: NativeAudioSample) => void
  ): boolean;
  stopCapture(): void;
  isCapturing(): boolean;
};

export const MicrophoneCapture = addon.MicrophoneCapture as new () => {
  startCapture(config: NativeCaptureConfig, callback: (sample: NativeAudioSample) => void): boolean;
  stopCapture(): void;
  isCapturing(): boolean;
};
