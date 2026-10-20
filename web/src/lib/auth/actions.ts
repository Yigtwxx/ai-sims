'use server';

import { hasLocale } from 'next-intl';
import { redirect } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { isSupabaseConfigured } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

export type SignInState = { error: 'notConfigured' | 'failed' } | null;

function readLocale(formData: FormData) {
  const value = formData.get('locale');
  return hasLocale(routing.locales, value) ? value : routing.defaultLocale;
}

export async function signInAnonymouslyAction(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const locale = readLocale(formData);
  if (!isSupabaseConfigured()) return { error: 'notConfigured' };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInAnonymously();
  if (error) return { error: 'failed' };

  redirect({ href: '/characters', locale });
  return null; // unreachable: redirect() throws
}

export async function signOutAction(formData: FormData): Promise<void> {
  const locale = readLocale(formData);
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect({ href: '/', locale });
}
