import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from '@/i18n/routing';
import { refreshSession } from '@/lib/supabase/proxy';

const handleI18nRouting = createMiddleware(routing);

// /{locale}/characters/** and /{locale}/create require a signed-in user.
const PROTECTED_PATH = new RegExp(`^/(${routing.locales.join('|')})/(characters|create)(/|$)`);
const LOCALE_PATH = new RegExp(`^/(${routing.locales.join('|')})(/|$)`);

export async function proxy(request: NextRequest) {
  // 1. next-intl: locale detection, prefix redirects, rewrite headers.
  const response = handleI18nRouting(request);

  // Locale redirects (e.g. / -> /tr) need no session work.
  if (response.headers.has('location')) return response;

  // 2. Supabase: refresh the session; refreshed cookies are written onto `response`.
  const userId = await refreshSession(request, response);

  // 3. Optimistic route protection. Pages re-check the session themselves.
  const { pathname } = request.nextUrl;
  if (!userId && PROTECTED_PATH.test(pathname)) {
    const locale = LOCALE_PATH.exec(pathname)?.[1] ?? routing.defaultLocale;
    const redirect = NextResponse.redirect(new URL(`/${locale}`, request.url));
    // Keep any cookies (e.g. a cleared session) set during refresh.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }

  return response;
}

export const config = {
  // Skip /spike (own root layout), /api, Next internals, /assets and any path with a file extension.
  matcher: ['/((?!(?:spike|api|_next|_vercel|assets)(?:/|$)|.*\\..*).*)'],
};
