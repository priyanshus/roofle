/** LLM provider configuration. */
export interface LlmConfig {
  readonly provider: 'openrouter' | 'ollama';
  readonly model: string;
  readonly baseUrl?: string;
  readonly apiKeyEnv?: string;
  readonly temperature?: number;
}

/** Cost-aware analysis scheduling knobs. */
export interface AnalysisConfig {
  readonly intervalMs: number;
  readonly minChars: number;
  readonly minNewChars: number;
  readonly cooldownMs: number;
  readonly concurrency: number;
  readonly maxRetries: number;
}

/** Top-level analyst configuration. */
export interface AnalystConfig {
  readonly llm: LlmConfig;
  readonly analysis: AnalysisConfig;
}
