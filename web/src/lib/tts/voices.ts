import type { ChatLocale } from '@/lib/ai/types';
import type { AzureSpeechEnv } from '@/lib/env';
import type { VoiceGender } from './types';

const FALLBACK_LANGUAGE: Record<ChatLocale, string> = { tr: 'tr-TR', en: 'en-US' };

export interface ResolvedVoice {
  /** Azure voice name, e.g. `tr-TR-EmelNeural`. */
  name: string;
  /** BCP-47 language for the SSML `xml:lang`, taken from the voice name. */
  language: string;
}

/** Picks the configured voice for a locale and gender. */
export function resolveVoice(
  env: Pick<AzureSpeechEnv, 'voices'>,
  locale: ChatLocale,
  gender: VoiceGender,
): ResolvedVoice {
  const name = env.voices[locale][gender];
  // "en-GB-SoniaNeural" -> "en-GB"; keeps xml:lang consistent when a voice is overridden.
  const language = /^([a-z]{2,3}-[A-Za-z]{2,4})-/.exec(name)?.[1] ?? FALLBACK_LANGUAGE[locale];
  return { name, language };
}
