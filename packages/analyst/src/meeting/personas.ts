import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PERSONAS, type Persona, type PersonaContext } from '@roofle/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Maps a persona id to its prompt file names. The generic fallback (no persona)
// uses the original evaluator/summarizer prompts.
interface PersonaPrompts {
  readonly evaluator: string;
  readonly summarizer: string;
}

const PROMPT_FILES: Record<string, PersonaPrompts> = {
  sales: {
    evaluator: 'evaluator-sales.txt',
    summarizer: 'summarizer-sales.txt',
  },
};

const DEFAULT_PROMPTS: PersonaPrompts = {
  evaluator: 'evaluator.txt',
  summarizer: 'summarizer.txt',
};

// Resolves the persona + context labels for prompt injection. Falls back to a
// neutral generic description when no persona is selected.
export function resolvePersona(
  personaId?: string,
  contextId?: string
): { persona?: Persona; context?: PersonaContext; label: string } {
  const persona = PERSONAS.find((p) => p.id === personaId);
  const context = persona?.contexts.find((c) => c.id === contextId);

  const label = persona
    ? context
      ? `${persona.label} — ${context.label}`
      : persona.label
    : 'General conversation';

  return { persona, context, label };
}

// Loads the persona-specific prompt text, falling back to the generic prompt
// when the persona has no dedicated file.
export function loadPrompt(kind: 'evaluator' | 'summarizer', personaId?: string): string {
  const file = personaId
    ? PROMPT_FILES[personaId]?.[kind] ?? DEFAULT_PROMPTS[kind]
    : DEFAULT_PROMPTS[kind];

  return fs.readFileSync(path.join(__dirname, 'prompts', file), 'utf8');
}
