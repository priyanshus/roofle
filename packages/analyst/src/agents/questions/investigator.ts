import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { Runnable } from '@langchain/core/runnables';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const QuestionSchema = z.object({
  questions: z
    .array(z.string())
    .describe('Clarifying questions that must be answered to fully understand the paragraph'),
  reasoning: z
    .string()
    .describe(
      'Brief rationale for the questions, or why no questions were generated when the array is empty'
    ),
});

const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, 'prompts', 'investigator.txt'),
  'utf8'
);

const PROMPT = ChatPromptTemplate.fromMessages([
  ['system', SYSTEM_PROMPT],
  [
    'human',
    '{sourceLabel} transcription:\n{paragraph}\n\n' +
      '{contextLabel} transcription:\n{context}',
  ],
]);

// First agent: reads the paragraph and produces clarifying questions.
// Uses the model's native structured output (tool calling) so the result is
// always schema-compliant, unlike text-based JSON parsing.
export class Investigator {
  private readonly chain: Runnable<
    { paragraph: string; sourceLabel: string; context: string; contextLabel: string },
    { questions: string[]; reasoning: string }
  >;

  constructor(model: BaseChatModel) {
    this.chain = PROMPT.pipe(
      model.withStructuredOutput(QuestionSchema)
    ) as unknown as Runnable<
      { paragraph: string; sourceLabel: string; context: string; contextLabel: string },
      { questions: string[]; reasoning: string }
    >;
  }

  async run(state: {
    paragraph: string;
    sourceLabel: string;
    context: string;
    contextLabel: string;
  }): Promise<{ questions: string[]; reasoning: string }> {
    const { questions, reasoning } = await this.chain.invoke({
      paragraph: state.paragraph,
      sourceLabel: state.sourceLabel,
      context: state.context,
      contextLabel: state.contextLabel,
    });

    return { questions, reasoning };
  }
}
