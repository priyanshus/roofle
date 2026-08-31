import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { Runnable } from '@langchain/core/runnables';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ResolvedQuestionSchema = z.object({
  id: z.number().describe('Id of the open question being resolved'),
  reason: z
    .string()
    .describe('Minimal reason: the answer itself, or why the question is stale'),
});

const ResolutionSchema = z.object({
  answered: z
    .array(ResolvedQuestionSchema)
    .describe('Open questions now answered by the new transcription'),
  stale: z
    .array(ResolvedQuestionSchema)
    .describe('Open questions no longer relevant to the conversation'),
});

const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, 'prompts', 'resolver.txt'),
  'utf8'
);

const PROMPT = ChatPromptTemplate.fromMessages([
  ['system', SYSTEM_PROMPT],
  [
    'human',
    '{sourceLabel} transcription (the other party):\n{paragraph}\n\n' +
      '{contextLabel} transcription (your own voice):\n{context}\n\n' +
      'Open questions (id: question):\n{questions}',
  ],
]);

// Third agent: one-way resolution. Given the new transcription and the
// currently-open questions, it returns which open questions are now answered
// or stale. It NEVER generates new questions, so there is no feedback loop.
export class Resolver {
  private readonly chain: Runnable<
    {
      paragraph: string;
      sourceLabel: string;
      context: string;
      contextLabel: string;
      questions: string;
    },
    { answered: { id: number; reason: string }[]; stale: { id: number; reason: string }[] }
  >;

  constructor(model: BaseChatModel) {
    this.chain = PROMPT.pipe(
      model.withStructuredOutput(ResolutionSchema)
    ) as unknown as Runnable<
      {
        paragraph: string;
        sourceLabel: string;
        context: string;
        contextLabel: string;
        questions: string;
      },
      { answered: { id: number; reason: string }[]; stale: { id: number; reason: string }[] }
    >;
  }

  async run(state: {
    paragraph: string;
    sourceLabel: string;
    context: string;
    contextLabel: string;
    openQuestions: { id: number; question: string }[];
  }): Promise<{
    answered: { id: number; reason: string }[];
    stale: { id: number; reason: string }[];
  }> {
    const { answered, stale } = await this.chain.invoke({
      paragraph: state.paragraph,
      sourceLabel: state.sourceLabel,
      context: state.context,
      contextLabel: state.contextLabel,
      questions: state.openQuestions.map((q) => `${q.id}: ${q.question}`).join('\n'),
    });

    return { answered, stale };
  }
}
