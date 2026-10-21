'use server';

import { hasLocale } from 'next-intl';
import { redirect } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { requireUserId } from '@/lib/auth/session';
import { CHARACTER_BASES } from '@/lib/character/schema';
import { createDefaultConfig } from '@/lib/character/defaults';
import { createCharacter, deleteCharacter } from '@/lib/characters/repository';
import { z } from 'zod';

export type CreateCharacterState = { error: 'invalid' | 'failed' } | null;

const FormSchema = z.object({
  name: z.string().trim().min(1).max(40),
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
    base: formData.get('base'),
  });
  if (!parsed.success) return { error: 'invalid' };

  try {
    const { name, base } = parsed.data;
    await createCharacter(userId, { name, config: createDefaultConfig(base) });
  } catch {
    return { error: 'failed' };
  }

  redirect({
    href: '/characters',
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
  });
  return null; // unreachable: redirect() throws
}

export type DeleteCharacterResult = { ok: true } | { ok: false; error: 'not_found' | 'failed' };

/** Deletes one of the signed-in user's characters (and its thumbnail). */
export async function deleteCharacterAction(id: string): Promise<DeleteCharacterResult> {
  // Server actions are public endpoints: always re-verify the session.
  const userId = await requireUserId();
  if (typeof id !== 'string' || id.length === 0) return { ok: false, error: 'not_found' };
  try {
    return (await deleteCharacter(userId, id)) ? { ok: true } : { ok: false, error: 'not_found' };
  } catch {
    return { ok: false, error: 'failed' };
  }
}
