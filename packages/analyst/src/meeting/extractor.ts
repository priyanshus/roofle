import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { Runnable } from '@langchain/core/runnables';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AudioSource, type MeetingTurn } from '@roofle/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TurnSchema = z.object({
  turns: z
    .array(
      z.object({
        speaker: z.enum(['microphone', 'system', 'unknown']),
        text: z.string(),
      })
    )
    .describe('Conversational turns in chronological order'),
});

const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, 'prompts', 'extractor.txt'),
  'utf8'
);

const PROMPT = ChatPromptTemplate.fromMessages([
  ['system', SYSTEM_PROMPT],
  ['human', 'Transcription:\n{transcription}'],
]);

// First agent: splits the raw transcription into attributed turns so the
// evaluator can reason about who said what.
export class Extractor {
  private readonly chain: Runnable<
    { transcription: string },
    { turns: { speaker: 'microphone' | 'system' | 'unknown'; text: string }[] }
  >;

  constructor(model: BaseChatModel) {
    this.chain = PROMPT.pipe(
      model.withStructuredOutput(TurnSchema)
    ) as unknown as Runnable<
      { transcription: string },
      { turns: { speaker: 'microphone' | 'system' | 'unknown'; text: string }[] }
    >;
  }

  async run(state: { transcription: string }): Promise<{ turns: MeetingTurn[] }> {
    const { turns } = await this.chain.invoke({ transcription: state.transcription });

    return {
      turns: turns.map((t) => ({
        speaker:
          t.speaker === 'microphone'
            ? AudioSource.MICROPHONE
            : t.speaker === 'system'
              ? AudioSource.SYSTEM_AUDIO
              : 'unknown',
        source: t.speaker === 'unknown' ? '' : t.speaker,
        text: t.text,
      })),
    };
  }
}
