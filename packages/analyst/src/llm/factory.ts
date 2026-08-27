import { ChatOpenAI } from '@langchain/openai';
import { ChatOllama } from '@langchain/ollama';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { LlmConfig } from '../config.js';

// Builds a chat model from config. Only the API key is read from the
// environment; everything else lives in config.json.
export function createChatModel(llmConfig: LlmConfig): BaseChatModel {
  const common = { temperature: llmConfig.temperature ?? 0 };

  if (llmConfig.provider === 'ollama') {
    return new ChatOllama({
      model: llmConfig.model,
      baseUrl: llmConfig.baseUrl,
      ...common,
    });
  }

  if (llmConfig.provider === 'openrouter') {
    const apiKey = llmConfig.apiKeyEnv ? process.env[llmConfig.apiKeyEnv] : undefined;
    if (!apiKey) {
      throw new Error(`Missing env var "${llmConfig.apiKeyEnv}" for OpenRouter`);
    }

    return new ChatOpenAI({
      model: llmConfig.model,
      apiKey,
      configuration: { baseURL: llmConfig.baseUrl },
      ...common,
    });
  }

  throw new Error(`Unsupported LLM provider "${llmConfig.provider}"`);
}
