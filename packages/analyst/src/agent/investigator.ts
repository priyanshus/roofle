import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { Runnable } from '@langchain/core/runnables';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const QuestionSchema = z.object({
  questions: z
    .array(z.string())
    .describe('Clarifying questions that must be answered to fully understand the paragraph'),
});

const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, 'prompts', 'investigator.txt'),
  'utf8'
);

const PROMPT = ChatPromptTemplate.fromMessages([
  ['system', SYSTEM_PROMPT],
  ['human', 'New transcription:\n{paragraph}'],
]);

// First agent: reads the paragraph and produces clarifying questions.
// Uses the model's native structured output (tool calling) so the result is
// always schema-compliant, unlike text-based JSON parsing.
export class Investigator {
  private readonly chain: Runnable<{ paragraph: string }, { questions: string[] }>;

  constructor(model: BaseChatModel) {
    this.chain = PROMPT.pipe(
      model.withStructuredOutput(QuestionSchema)
    ) as unknown as Runnable<{ paragraph: string }, { questions: string[] }>;
  }

  async run(state: { paragraph: string }): Promise<{ questions: string[] }> {
    const { questions } = await this.chain.invoke({ paragraph: state.paragraph });

    return { questions };
  }
}
