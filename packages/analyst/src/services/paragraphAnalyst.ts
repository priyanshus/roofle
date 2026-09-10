import { buildGraph } from '../agents/questions/graph.js';
import type { LlmConfig } from '../config.js';
import { createChatModel } from '../llm/factory.js';

export interface ResolvedQuestion {
  id: number;
  reason: string;
}

export interface AnalysisResult {
  questions: string[];
  answered: ResolvedQuestion[];
  stale: ResolvedQuestion[];
  /** The updated rolling conversation summary produced by the summary agent. */
  summary: string;
}

// Runs the three-agent graph over the new transcription delta and the
// currently-open questions. Returns the new validated questions plus the ids
// of open questions the resolver marked answered or stale.
export class ParagraphAnalyst {
  private readonly graph: ReturnType<typeof buildGraph>;

  constructor(llmConfig: LlmConfig, enableSummary = true) {
    this.graph = buildGraph(createChatModel(llmConfig));
    this.enableSummary = enableSummary;
  }

  private readonly enableSummary: boolean;

  async analyze(
    paragraph: string,
    sourceLabel: string,
    context: string,
    contextLabel: string,
    openQuestions: { id: number; question: string }[],
    prevSummary: string
  ): Promise<AnalysisResult> {
    const result = await this.graph.invoke({
      paragraph,
      sourceLabel,
      context,
      contextLabel,
      openQuestions,
      enableSummary: this.enableSummary,
      prevSummary,
    });

    return {
      questions: result.validatedQuestions,
      answered: result.answered,
      stale: result.stale,
      summary: result.summary ?? '',
    };
  }
}
