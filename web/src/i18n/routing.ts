import { defineRouting } from 'next-intl/routing';

// English first, Turkish second (2026-10-27). Visitors start in English
// whatever their browser says; the switch (and its cookie) picks Turkish.
export const routing = defineRouting({
  locales: ['en', 'tr'],
  defaultLocale: 'en',
  localePrefix: 'always',
  localeDetection: false,
});

export type Locale = (typeof routing.locales)[number];
