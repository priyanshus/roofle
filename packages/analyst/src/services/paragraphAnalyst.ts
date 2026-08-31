import { buildGraph } from '../agents/questions/graph.js';
import type { LlmConfig } from '../config.js';
import { createChatModel } from '../llm/factory.js';

export interface AnalysisResult {
  questions: string[];
  answeredIds: number[];
  staleIds: number[];
}

// Runs the three-agent graph over the new transcription delta and the
// currently-open questions. Returns the new validated questions plus the ids
// of open questions the resolver marked answered or stale.
export class ParagraphAnalyst {
  private readonly graph: ReturnType<typeof buildGraph>;

  constructor(llmConfig: LlmConfig) {
    this.graph = buildGraph(createChatModel(llmConfig));
  }

  async analyze(
    paragraph: string,
    sourceLabel: string,
    context: string,
    contextLabel: string,
    openQuestions: { id: number; question: string }[]
  ): Promise<AnalysisResult> {
    const result = await this.graph.invoke({
      paragraph,
      sourceLabel,
      context,
      contextLabel,
      openQuestions,
    });

    return {
      questions: result.validatedQuestions,
      answeredIds: result.answeredIds,
      staleIds: result.staleIds,
    };
  }
}
