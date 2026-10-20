import { z } from 'zod';
import { CHAT_LOCALES, MAX_CHAT_MESSAGE_CHARS, MAX_CHAT_MESSAGES } from './types';

/** Body of `POST /api/chat`. Everything here is client input and therefore untrusted. */
export const ChatRequestSchema = z.object({
  /** Optional; loaded through the repository, scoped to the signed-in user. */
  characterId: z.string().trim().min(1).max(64).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(MAX_CHAT_MESSAGE_CHARS),
      }),
    )
    .min(1)
    .max(MAX_CHAT_MESSAGES),
  locale: z.enum(CHAT_LOCALES),
});

export type ChatRequestBody = z.infer<typeof ChatRequestSchema>;
