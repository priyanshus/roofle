import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { Runnable } from '@langchain/core/runnables';
import type { MeetingMetric } from '@roofle/shared';
import { z } from 'zod';
import { loadPrompt, resolvePersona } from './personas.js';

const MetricSchema = z.object({
  metrics: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        score: z.number().min(0).max(100),
        summary: z.string(),
        evidence: z.array(z.string()),
      })
    )
    .describe('Scored meeting-quality metrics'),
});

const PROMPT = ChatPromptTemplate.fromMessages([
  ['system', '{systemPrompt}'],
  ['human', 'Transcription:\n{transcription}'],
]);

// The only agent in the meeting-analysis graph: scores the meeting across
// quality metrics directly from the raw transcription, each with evidence
// quoted from the text so the dashboard can justify every score. The prompt is
// selected per persona so the metrics reflect the chosen role.
export class Evaluator {
  private readonly chain: Runnable<
    { systemPrompt: string; transcription: string },
    { metrics: MeetingMetric[] }
  >;

  constructor(model: BaseChatModel) {
    this.chain = PROMPT.pipe(
      model.withStructuredOutput(MetricSchema)
    ) as unknown as Runnable<
      { systemPrompt: string; transcription: string },
      { metrics: MeetingMetric[] }
    >;
  }

  async run(state: {
    transcription: string;
    persona?: string;
    personaContext?: string;
  }): Promise<{ metrics: MeetingMetric[] }> {
    const { label } = resolvePersona(state.persona, state.personaContext);
    const systemPrompt = loadPrompt('evaluator', state.persona).replace(
      '{persona}',
      label
    );

    const { metrics } = await this.chain.invoke({
      systemPrompt,
      transcription: state.transcription,
    });
    return { metrics };
  }
}
