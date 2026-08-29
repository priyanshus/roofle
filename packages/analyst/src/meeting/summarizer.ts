import { z } from 'zod';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { Runnable } from '@langchain/core/runnables';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { MeetingMetric, MeetingTurn } from '@roofle/shared';
import { loadPrompt, resolvePersona } from './personas.js';

const SummarySchema = z.object({
  summary: z.string().describe('One-paragraph executive summary of the meeting'),
  recommendations: z
    .array(z.string())
    .describe('Actionable recommendations for the host'),
});

const PROMPT = ChatPromptTemplate.fromMessages([
  ['system', '{systemPrompt}'],
  [
    'human',
    'Turns:\n{turns}\n\nMetrics:\n{metrics}',
  ],
]);

// Third agent: distills the turns and scored metrics into an executive summary
// and a short list of actionable recommendations. The prompt is selected per
// persona so the summary and advice reflect the chosen role.
export class Summarizer {
  private readonly chain: Runnable<
    { systemPrompt: string; turns: string; metrics: string },
    { summary: string; recommendations: string[] }
  >;

  constructor(model: BaseChatModel) {
    this.chain = PROMPT.pipe(
      model.withStructuredOutput(SummarySchema)
    ) as unknown as Runnable<
      { systemPrompt: string; turns: string; metrics: string },
      { summary: string; recommendations: string[] }
    >;
  }

  async run(state: {
    turns: MeetingTurn[];
    metrics: MeetingMetric[];
    persona?: string;
    personaContext?: string;
  }): Promise<{ summary: string; recommendations: string[] }> {
    const turnsText = state.turns.map((t) => `[${t.speaker}] ${t.text}`).join('\n');
    const metricsText = state.metrics
      .map((m) => `${m.label} (${m.score}/100): ${m.summary}`)
      .join('\n');

    const { label } = resolvePersona(state.persona, state.personaContext);
    const systemPrompt = loadPrompt('summarizer', state.persona).replace(
      '{persona}',
      label
    );

    const { summary, recommendations } = await this.chain.invoke({
      systemPrompt,
      turns: turnsText,
      metrics: metricsText,
    });

    return { summary, recommendations };
  }
}
