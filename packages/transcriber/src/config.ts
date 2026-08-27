import fs from 'fs';
import path from 'path';
import type { AppConfig } from './types';

/**
 * Static tuning parameters read from the root config.json. These are
 * algorithm/quality knobs that rarely change per deployment.
 */
interface ConfigFile {
  readonly audio?: {
    readonly inputSampleRate?: number;
    readonly outputSampleRate?: number;
    readonly inputChannels?: number;
    readonly outputChannels?: number;
    readonly chunkDurationMs?: number;
    readonly queueMaxMs?: number;
  };
  readonly stt?: {
    readonly maxWsBufferedBytes?: number;
    readonly maxWsQueueBytes?: number;
    readonly reconnectBaseDelayMs?: number;
    readonly reconnectMaxDelayMs?: number;
  };
  readonly vad?: {
    readonly threshold?: number;
  };
  readonly echoSuppression?: {
    readonly threshold?: number;
    readonly hangoverMs?: number;
  };
}

function parseList(value: string | undefined, fallback: readonly string[]): readonly string[] {
  if (!value) return fallback;
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : fallback;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function loadConfigFile(): ConfigFile {
  const configPath = path.join(__dirname, '..', 'config.json');
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw) as ConfigFile;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const file = loadConfigFile();
  const audio = file.audio ?? {};
  const stt = file.stt ?? {};
  const vad = file.vad ?? {};
  const echo = file.echoSuppression ?? {};

  return {
    wsUrl: env.STT_WS_URL ?? 'ws://127.0.0.1:9000',
    wsToken: env.STT_WS_TOKEN,
    appHints: parseList(env.CAPTURE_APPS, ['Brave Browser', 'Google Chrome', 'Safari', 'Music', 'Spotify']),
    logMetrics: parseBool(env.LOG_METRICS, false),
    chunkDurationMs: audio.chunkDurationMs ?? 20,
    inputSampleRate: audio.inputSampleRate ?? 48000,
    outputSampleRate: audio.outputSampleRate ?? 16000,
    inputChannels: (audio.inputChannels as 1 | 2) ?? 2,
    outputChannels: 1,
    queueMaxMs: audio.queueMaxMs ?? 1000,
    maxWsBufferedBytes: stt.maxWsBufferedBytes ?? 256 * 1024,
    maxWsQueueBytes: stt.maxWsQueueBytes ?? 1024 * 1024,
    reconnectBaseDelayMs: stt.reconnectBaseDelayMs ?? 500,
    reconnectMaxDelayMs: stt.reconnectMaxDelayMs ?? 10_000,
    captureMicrophone: parseBool(env.CAPTURE_MICROPHONE, true),
    captureSystemAudio: parseBool(env.CAPTURE_SYSTEM_AUDIO, true),
    vadEnabled: parseBool(env.VAD_ENABLED, true),
    vadThreshold: vad.threshold ?? 0.01,
    echoSuppressionEnabled: parseBool(env.ECHO_SUPPRESSION_ENABLED, true),
    echoSuppressionThreshold: echo.threshold ?? 0.01,
    echoSuppressionHangoverMs: echo.hangoverMs ?? 500,
  };
}
