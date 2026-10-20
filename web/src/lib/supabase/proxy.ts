import { createServerClient } from '@supabase/ssr';
import type { NextRequest, NextResponse } from 'next/server';
import { getSupabaseEnv } from '@/lib/env';
import type { Database } from './database.types';

/**
 * Refreshes the Supabase session for this request and writes any refreshed
 * auth cookies onto `response`. Returns the user id (JWT `sub`), or null when
 * signed out or when Supabase is not configured.
 *
 * Call it with the response you will actually return (e.g. the next-intl one).
 */
export async function refreshSession(
  request: NextRequest,
  response: NextResponse,
): Promise<string | null> {
  const env = getSupabaseEnv();
  if (!env) return null;

  const supabase = createServerClient<Database>(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value, options } of cookiesToSet) {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        }
        // Includes Cache-Control: private, no-store so CDNs never cache Set-Cookie.
        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // Must run right after client creation: triggers the token refresh.
  const { data } = await supabase.auth.getClaims();
  return data?.claims?.sub ?? null;
}
