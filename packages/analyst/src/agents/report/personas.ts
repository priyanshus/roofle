import { PERSONAS, type Persona, type PersonaContext } from '@roofle/shared';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Maps a persona id to its prompt directory. The generic fallback (no persona)
// uses the original evaluator prompt at the prompts root.
const PROMPT_DIRS: Record<string, string> = {
  sales: 'sales',
  engineering: 'engineering',
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
// when the persona has no dedicated directory.
export function loadPrompt(kind: 'evaluator', personaId?: string): string {
  const dir = personaId ? PROMPT_DIRS[personaId] : undefined;
  const file = dir ? path.join(dir, `${kind}.txt`) : `${kind}.txt`;

  return fs.readFileSync(path.join(__dirname, 'prompts', file), 'utf8');
}
