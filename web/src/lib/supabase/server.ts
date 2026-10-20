import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { requireSupabaseEnv } from '@/lib/env';
import type { Database } from './database.types';

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * Creates a new client per call; never cache it across requests.
 * Throws SupabaseNotConfiguredError without env.
 */
export async function createClient() {
  const { url, anonKey } = requireSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, which cannot set cookies.
          // Safe to ignore: the proxy refreshes the session on every request.
        }
      },
    },
  });
}
