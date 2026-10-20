import 'server-only';
import { headers } from 'next/headers';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getAuth } from '@/lib/auth/auth';
import { isDatabaseConfigured } from '@/lib/env';

export type SessionUser = { id: string; isAnonymous: boolean };

/**
 * Reads and validates the current session against the database.
 * Returns null when signed out or when the database is not configured.
 * Reads request headers, so call it only inside a <Suspense> boundary.
 */
export async function getSession(): Promise<SessionUser | null> {
  if (!isDatabaseConfigured()) return null;
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  return { id: session.user.id, isAnonymous: session.user.isAnonymous === true };
}

/**
 * Authoritative auth check for pages and server actions: returns the user id or
 * redirects to the landing page. The proxy only does an optimistic cookie check.
 */
export async function requireUserId(): Promise<string> {
  const user = await getSession();
  if (user) return user.id;
  redirect({ href: '/', locale: await getLocale() });
  throw new Error('unreachable: redirect() throws'); // redirect() is not typed as never here
}
