import { z } from 'zod';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { Runnable } from '@langchain/core/runnables';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { MeetingMetric, MeetingTurn } from '@roofle/shared';
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
  ['human', 'Turns:\n{turns}'],
]);

// Second agent: scores the meeting across quality metrics, each with evidence
// quoted from the turns so the dashboard can justify every score. The prompt is
// selected per persona so the metrics reflect the chosen role.
export class Evaluator {
  private readonly chain: Runnable<
    { systemPrompt: string; turns: string },
    { metrics: MeetingMetric[] }
  >;

  constructor(model: BaseChatModel) {
    this.chain = PROMPT.pipe(
      model.withStructuredOutput(MetricSchema)
    ) as unknown as Runnable<
      { systemPrompt: string; turns: string },
      { metrics: MeetingMetric[] }
    >;
  }

  async run(state: {
    turns: MeetingTurn[];
    persona?: string;
    personaContext?: string;
  }): Promise<{ metrics: MeetingMetric[] }> {
    const turnsText = state.turns
      .map((t) => `[${t.speaker}] ${t.text}`)
      .join('\n');

    const { label } = resolvePersona(state.persona, state.personaContext);
    const systemPrompt = loadPrompt('evaluator', state.persona).replace(
      '{persona}',
      label
    );

    const { metrics } = await this.chain.invoke({
      systemPrompt,
      turns: turnsText,
    });
    return { metrics };
  }
}
