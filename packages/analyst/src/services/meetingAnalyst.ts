import type { MeetingAnalysis } from '@roofle/shared';
import { buildMeetingGraph } from '../meeting/graph.js';
import { createChatModel } from '../llm/factory.js';
import type { LlmConfig } from '../config.js';

// Runs the meeting-analysis graph over a full session transcription and
// returns a dashboard-ready report. This is a separate agent from the
// questions pipeline; it does not reuse its prompts or graph.
export class MeetingAnalyst {
  private readonly graph: ReturnType<typeof buildMeetingGraph>;

  constructor(llmConfig: LlmConfig) {
    this.graph = buildMeetingGraph(createChatModel(llmConfig));
  }

  async analyze(
    transcription: string,
    persona?: string,
    personaContext?: string
  ): Promise<{
    summary: string;
    metrics: MeetingAnalysis['metrics'];
    turns: MeetingAnalysis['turns'];
    recommendations: string[];
    persona?: string;
    personaContext?: string;
  }> {
    const result = await this.graph.invoke({ transcription, persona, personaContext });

    return {
      summary: result.summary,
      metrics: result.metrics,
      turns: result.turns,
      recommendations: result.recommendations,
      persona,
      personaContext,
    };
  }
}
