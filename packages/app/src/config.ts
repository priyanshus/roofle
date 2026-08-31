import fs from 'fs';
import path from 'path';

export interface AppPaths {
  readonly whisperDir: string;
  readonly uiDir: string;
  readonly dbPath: string;
}

export interface AnalystConfig {
  llm: {
    provider: 'openrouter' | 'ollama';
    model: string;
    baseUrl?: string;
    apiKeyEnv?: string;
    temperature?: number;
  };
  analysis: {
    intervalMs: number;
    minChars: number;
    minNewChars: number;
    cooldownMs: number;
    concurrency: number;
    maxRetries: number;
  };
}

export function resolvePaths(): AppPaths {
  const whisperDir = path.resolve(__dirname, '../../transcriber/whisper');
  // Prefer the built Vite bundle; fall back to the source UI for development.
  const builtUi = path.resolve(__dirname, '../ui/dist');
  const uiDir = fs.existsSync(builtUi) ? builtUi : path.resolve(__dirname, '../ui');
  const dbPath = path.resolve(__dirname, '../../analyst/data.db');
  return { whisperDir, uiDir, dbPath };
}

export function loadAnalystConfig(): AnalystConfig {
  const configPath = path.resolve(__dirname, '../../analyst/config.json');
  const raw = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(raw) as AnalystConfig;

  // Env vars override config.json so the LLM can be switched without editing
  // the file. Only set values are applied; unset ones keep the file default.
  if (process.env.LLM_PROVIDER) {
    config.llm.provider = process.env.LLM_PROVIDER as 'openrouter' | 'ollama';
  }
  if (process.env.LLM_MODEL) {
    config.llm.model = process.env.LLM_MODEL;
  }
  if (process.env.LLM_BASE_URL) {
    config.llm.baseUrl = process.env.LLM_BASE_URL;
  }
  if (process.env.LLM_TEMPERATURE) {
    config.llm.temperature = Number(process.env.LLM_TEMPERATURE);
  }

  return config;
}
