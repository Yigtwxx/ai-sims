import type { CharacterBase, CharacterStyle } from '@/lib/character/schema';
import { renderPersonaPrompt } from './prompts/persona.template';
import type { ChatLocale } from './types';

/** The parts of a saved character that shape how the companion talks. */
export interface PersonaCharacter {
  name: string;
  base: CharacterBase;
  style: CharacterStyle;
}

export const MAX_PERSONA_NAME_CHARS = 40;

/**
 * Character names are user-supplied and end up inside the system prompt, so
 * strip control characters (no injected lines), angle brackets, backticks and
 * backslashes, collapse whitespace and cap the length.
 */
export function sanitizeCharacterName(name: string): string | undefined {
  const cleaned = name
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/[<>`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PERSONA_NAME_CHARS)
    .trim();
  return cleaned || undefined;
}

/**
 * Builds the system prompt for a chat turn. Without a character the companion
 * is generic: no name, no gender, no art style.
 */
export function buildSystemPrompt(input: {
  character?: PersonaCharacter;
  locale: ChatLocale;
}): string {
  const { character, locale } = input;
  return renderPersonaPrompt({
    name: character ? sanitizeCharacterName(character.name) : undefined,
    base: character?.base,
    style: character?.style,
    locale,
  });
}
