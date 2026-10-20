import 'server-only';
import { isSupabaseConfigured } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

export type SessionUser = { id: string; isAnonymous: boolean };

/**
 * Reads the current user from the verified JWT claims.
 * Returns null when signed out or when Supabase is not configured.
 * Reads cookies, so call it only inside a <Suspense> boundary.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { id: claims.sub, isAnonymous: claims.is_anonymous === true };
}
