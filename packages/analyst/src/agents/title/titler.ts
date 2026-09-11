import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { Runnable } from '@langchain/core/runnables';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TitleSchema = z.object({
  title: z.string().describe('A single, concise, human-readable title for the conversation'),
});

const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, 'prompts', 'titler.txt'),
  'utf8'
);

const PROMPT = ChatPromptTemplate.fromMessages([
  ['system', SYSTEM_PROMPT],
  ['human', 'Conversation summary:\n{summary}'],
]);

// The title agent: turns the final rolling conversation summary into a single
// one-line title shown in the library. It runs once per conversation, on
// session finalize, so the LLM cost stays bounded.
export class Titler {
  private readonly chain: Runnable<{ summary: string }, { title: string }>;

  constructor(model: BaseChatModel) {
    this.chain = PROMPT.pipe(
      model.withStructuredOutput(TitleSchema)
    ) as unknown as Runnable<{ summary: string }, { title: string }>;
  }

  async run(state: { summary: string }): Promise<{ title: string }> {
    return this.chain.invoke({ summary: state.summary });
  }
}
