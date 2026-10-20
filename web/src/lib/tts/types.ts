import type { ChatLocale } from '@/lib/ai/types';

/** Pure types shared by the TTS route, the Azure wrapper and the browser client. */

/** Longest text accepted by `POST /api/tts` (one sentence or two is typical). */
export const MAX_TTS_TEXT_CHARS = 1200;

export const VOICE_GENDERS = ['female', 'male'] as const;
export type VoiceGender = (typeof VOICE_GENDERS)[number];

/** One Azure voice per locale and gender. */
export type TtsVoices = Record<ChatLocale, Record<VoiceGender, string>>;

/** Azure viseme event: `time` in seconds, `id` is the Microsoft viseme id (0-21). */
export interface TtsViseme {
  time: number;
  id: number;
}

/** Azure word boundary event; all values in seconds. */
export interface TtsWord {
  time: number;
  duration: number;
  text: string;
}

/** JSON body returned by `POST /api/tts`. */
export interface TtsResponseBody {
  /** Base64-encoded audio. */
  audio: string;
  mime: string;
  visemes: TtsViseme[];
  words: TtsWord[];
}
