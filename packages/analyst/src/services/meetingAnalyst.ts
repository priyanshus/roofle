import type { MeetingAnalysis } from '@roofle/shared';
import { buildMeetingGraph } from '../agents/report/graph.js';
import type { LlmConfig } from '../config.js';
import { createChatModel } from '../llm/factory.js';

// Runs the meeting-analysis graph over a full session transcription and
// returns scored metrics for the dashboard. This is a separate agent from the
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
    metrics: MeetingAnalysis['metrics'];
    persona?: string;
    personaContext?: string;
  }> {
    const result = await this.graph.invoke({ transcription, persona, personaContext });

    return {
      metrics: result.metrics,
      persona,
      personaContext,
    };
  }
}
