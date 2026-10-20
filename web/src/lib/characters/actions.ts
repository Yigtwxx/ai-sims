'use server';

import { hasLocale } from 'next-intl';
import { redirect } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { requireUserId } from '@/lib/auth/session';
import { CHARACTER_BASES, CHARACTER_STYLES } from '@/lib/character/schema';
import { createDefaultConfig } from '@/lib/character/defaults';
import { createCharacter } from '@/lib/characters/repository';
import { z } from 'zod';

export type CreateCharacterState = { error: 'invalid' | 'failed' } | null;

const FormSchema = z.object({
  name: z.string().trim().min(1).max(40),
  style: z.enum(CHARACTER_STYLES),
  base: z.enum(CHARACTER_BASES),
});

export async function createCharacterAction(
  _previous: CreateCharacterState,
  formData: FormData,
): Promise<CreateCharacterState> {
  // Re-verify the session here: server actions are public endpoints.
  const userId = await requireUserId();

  const locale = formData.get('locale');
  const parsed = FormSchema.safeParse({
    name: formData.get('name'),
    style: formData.get('style'),
    base: formData.get('base'),
  });
  if (!parsed.success) return { error: 'invalid' };

  try {
    const { name, style, base } = parsed.data;
    await createCharacter(userId, { name, config: createDefaultConfig(style, base) });
  } catch {
    return { error: 'failed' };
  }

  redirect({
    href: '/characters',
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
  });
  return null; // unreachable: redirect() throws
}
