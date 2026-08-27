import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { Runnable } from '@langchain/core/runnables';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ValidatedQuestionSchema = z.object({
  questions: z
    .array(z.string())
    .describe('Questions that are NOT answered in the paragraph and are important enough to clarify'),
});

const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, 'prompts', 'validator.txt'),
  'utf8'
);

const PROMPT = ChatPromptTemplate.fromMessages([
  ['system', SYSTEM_PROMPT],
  ['human', 'Paragraph:\n{paragraph}\n\nCandidate questions:\n{questions}'],
]);

// Second agent: filters out answered or unimportant questions.
// Uses the model's native structured output (tool calling) so the result is
// always schema-compliant, unlike text-based JSON parsing.
export class Validator {
  private readonly chain: Runnable<
    { paragraph: string; questions: string },
    { questions: string[] }
  >;

  constructor(model: BaseChatModel) {
    this.chain = PROMPT.pipe(
      model.withStructuredOutput(ValidatedQuestionSchema)
    ) as unknown as Runnable<
      { paragraph: string; questions: string },
      { questions: string[] }
    >;
  }

  async run(state: {
    paragraph: string;
    questions: string[];
  }): Promise<{ validatedQuestions: string[] }> {
    const { questions } = await this.chain.invoke({
      paragraph: state.paragraph,
      questions: state.questions.join('\n'),
    });

    return { validatedQuestions: questions };
  }
}
