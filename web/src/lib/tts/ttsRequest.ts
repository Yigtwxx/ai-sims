import { z } from 'zod';
import { CHAT_LOCALES } from '@/lib/ai/types';
import { MAX_TTS_TEXT_CHARS, VOICE_GENDERS } from './types';

/** Body of `POST /api/tts`. Client input, therefore untrusted. */
export const TtsRequestSchema = z.object({
  text: z.string().trim().min(1).max(MAX_TTS_TEXT_CHARS),
  voice: z.enum(VOICE_GENDERS),
  locale: z.enum(CHAT_LOCALES),
});

export type TtsRequestBody = z.infer<typeof TtsRequestSchema>;
