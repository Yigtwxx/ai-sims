'use server';

import { headers } from 'next/headers';
import { hasLocale } from 'next-intl';

import { redirect } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { getAuth } from '@/lib/auth/auth';
import { getSession } from '@/lib/auth/session';
import { isDatabaseConfigured } from '@/lib/env';

export type EnterState = { error: 'notConfigured' | 'failed' } | null;

/** Where an "enter" form may send the user afterwards. Anything else falls back to the list. */
const DESTINATIONS = ['/characters', '/create'] as const;
export type EnterDestination = (typeof DESTINATIONS)[number];

function readDestination(formData: FormData): EnterDestination {
  const value = formData.get('next');
  return DESTINATIONS.find((destination) => destination === value) ?? '/characters';
}

function readLocale(formData: FormData) {
  const value = formData.get('locale');
  return hasLocale(routing.locales, value) ? value : routing.defaultLocale;
}

/**
 * One-click entry: signs in anonymously when there is no session yet, then
 * continues to an allow-listed destination. Mirrors `signInAnonymouslyAction`
 * (src/lib/auth/actions.ts) with a destination, so the landing CTA can go
 * straight to the creator and a signed-in visitor is never signed in twice.
 */
export async function enterAction(_previous: EnterState, formData: FormData): Promise<EnterState> {
  const locale = readLocale(formData);
  const destination = readDestination(formData);
  if (!isDatabaseConfigured()) return { error: 'notConfigured' };

  try {
    if (!(await getSession())) {
      await getAuth().api.signInAnonymous({ headers: await headers() });
    }
  } catch {
    return { error: 'failed' };
  }

  redirect({ href: destination, locale });
  return null; // unreachable: redirect() throws
}
