import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { Runnable } from '@langchain/core/runnables';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SummarySchema = z.object({
  summary: z.string().describe('The updated rolling summary of the whole conversation so far'),
});

const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, 'prompts', 'summarizer.txt'),
  'utf8'
);

const PROMPT = ChatPromptTemplate.fromMessages([
  ['system', SYSTEM_PROMPT],
  [
    'human',
    'Previous summary:\n{prevSummary}\n\n' +
      '{sourceLabel} transcription (the other party):\n{paragraph}\n\n' +
      '{contextLabel} transcription (your own voice):\n{context}',
  ],
]);

// The summary agent: maintains a single rolling summary of the whole
// conversation so far. Each run it compresses (prevSummary + the newest
// content from both sides) into a concise summary that the downstream question
// agents use as shared conversational context.
export class Summarizer {
  private readonly chain: Runnable<
    {
      prevSummary: string;
      sourceLabel: string;
      paragraph: string;
      contextLabel: string;
      context: string;
    },
    { summary: string }
  >;

  constructor(model: BaseChatModel) {
    this.chain = PROMPT.pipe(
      model.withStructuredOutput(SummarySchema)
    ) as unknown as Runnable<
      {
        prevSummary: string;
        sourceLabel: string;
        paragraph: string;
        contextLabel: string;
        context: string;
      },
      { summary: string }
    >;
  }

  async run(state: {
    prevSummary: string;
    sourceLabel: string;
    paragraph: string;
    contextLabel: string;
    context: string;
  }): Promise<{ summary: string }> {
    return this.chain.invoke({
      prevSummary: state.prevSummary,
      sourceLabel: state.sourceLabel,
      paragraph: state.paragraph,
      contextLabel: state.contextLabel,
      context: state.context,
    });
  }
}
