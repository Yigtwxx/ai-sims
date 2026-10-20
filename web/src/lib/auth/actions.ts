'use server';

import { headers } from 'next/headers';
import { hasLocale } from 'next-intl';
import { redirect } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { getAuth } from '@/lib/auth/auth';
import { getSession } from '@/lib/auth/session';
import { isDatabaseConfigured } from '@/lib/env';

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
  if (!isDatabaseConfigured()) return { error: 'notConfigured' };

  try {
    // Re-entering with a live session must not create a second anonymous user.
    if (!(await getSession())) {
      await getAuth().api.signInAnonymous({ headers: await headers() });
    }
  } catch {
    return { error: 'failed' };
  }

  redirect({ href: '/characters', locale });
  return null; // unreachable: redirect() throws
}

export async function signOutAction(formData: FormData): Promise<void> {
  const locale = readLocale(formData);
  if (isDatabaseConfigured()) {
    await getAuth().api.signOut({ headers: await headers() });
  }
  redirect({ href: '/', locale });
}
