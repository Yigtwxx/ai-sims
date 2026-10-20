import { getSessionCookie } from 'better-auth/cookies';
import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from '@/i18n/routing';

const handleI18nRouting = createMiddleware(routing);

// /{locale}/characters/** and /{locale}/create require a signed-in user.
const PROTECTED_PATH = new RegExp(`^/(${routing.locales.join('|')})/(characters|create)(/|$)`);
const LOCALE_PATH = new RegExp(`^/(${routing.locales.join('|')})(/|$)`);

export function proxy(request: NextRequest) {
  // 1. next-intl: locale detection, prefix redirects, rewrite headers.
  const response = handleI18nRouting(request);

  // Locale redirects (e.g. / -> /tr) need no session work.
  if (response.headers.has('location')) return response;

  // 2. Optimistic route protection: only checks that a session cookie exists (no DB hit).
  // Pages and actions verify the session server-side via requireUserId().
  const { pathname } = request.nextUrl;
  if (PROTECTED_PATH.test(pathname) && !getSessionCookie(request)) {
    const locale = LOCALE_PATH.exec(pathname)?.[1] ?? routing.defaultLocale;
    return NextResponse.redirect(new URL(`/${locale}`, request.url));
  }

  return response;
}

export const config = {
  // Skip /dev (own root layout), /api, Next internals, /assets and any path with a file extension.
  matcher: ['/((?!(?:dev|api|_next|_vercel|assets)(?:/|$)|.*\\..*).*)'],
};
