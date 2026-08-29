import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { Runnable } from '@langchain/core/runnables';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ResolutionSchema = z.object({
  answeredIds: z
    .array(z.number())
    .describe('Ids of open questions now answered by the new transcription'),
  staleIds: z
    .array(z.number())
    .describe('Ids of open questions no longer relevant to the conversation'),
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
    { answeredIds: number[]; staleIds: number[] }
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
      { answeredIds: number[]; staleIds: number[] }
    >;
  }

  async run(state: {
    paragraph: string;
    sourceLabel: string;
    context: string;
    contextLabel: string;
    openQuestions: { id: number; question: string }[];
  }): Promise<{ answeredIds: number[]; staleIds: number[] }> {
    const { answeredIds, staleIds } = await this.chain.invoke({
      paragraph: state.paragraph,
      sourceLabel: state.sourceLabel,
      context: state.context,
      contextLabel: state.contextLabel,
      questions: state.openQuestions.map((q) => `${q.id}: ${q.question}`).join('\n'),
    });

    return { answeredIds, staleIds };
  }
}
