export type AudioFormat = 'float32' | 'int16';

/**
 * Identifies which physical input produced an audio frame. Kept separate so
 * the downstream transcript can reconstruct the conversation timeline and
 * attribute each utterance to its source.
 */
export enum AudioSource {
  MICROPHONE = 'microphone',
  SYSTEM_AUDIO = 'system',
}

/**
 * A timestamped audio frame leaving the native capture layer. Every frame
 * carries enough metadata to reconstruct the timeline without any knowledge
 * of the underlying Core Audio / ScreenCaptureKit objects.
 */
export interface TimestampedAudioFrame {
  readonly data: Buffer;
  readonly sampleRate: number;
  readonly channels: number;
  readonly format: AudioFormat;
  readonly source: AudioSource;
  readonly captureTimestampMs: number;
  readonly durationMs: number;
}

export interface PipelineMetricsSnapshot {
  readonly queueBytes: number;
  readonly queueDrops: number;
  readonly chunksSent: number;
  readonly chunksDropped: number;
  readonly bytesSent: number;
  readonly reconnectCount: number;
  readonly conversionErrors: number;
  readonly wsSendFailures: number;
  readonly avgCaptureToSendLatencyMs: number;
  readonly avgTranscriptionLatencyMs: number;
  readonly lastTranscriptionLatencyMs: number;
}

export interface AppConfig {
  readonly wsUrl: string;
  readonly wsToken?: string;
  readonly appHints: readonly string[];
  readonly logMetrics: boolean;
  readonly chunkDurationMs: number;
  readonly inputSampleRate: number;
  readonly outputSampleRate: number;
  readonly inputChannels: 1 | 2;
  readonly outputChannels: 1;
  readonly queueMaxMs: number;
  readonly maxWsBufferedBytes: number;
  readonly maxWsQueueBytes: number;
  readonly reconnectBaseDelayMs: number;
  readonly reconnectMaxDelayMs: number;
  readonly captureMicrophone: boolean;
  readonly captureSystemAudio: boolean;
  readonly vadEnabled: boolean;
  readonly vadThreshold: number;
  readonly echoSuppressionEnabled: boolean;
  readonly echoSuppressionThreshold: number;
  readonly echoSuppressionHangoverMs: number;
}
