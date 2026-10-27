import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { locale as localeParam } from 'next/root-params';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { AppProviders } from '@/components/shell/AppProviders';
import { InlineScript } from '@/components/shell/InlineScript';
import { routing } from '@/i18n/routing';
import { fontVariables } from '@/styles/fonts';
import '../globals.css';

// Rendering strategy: every [locale] route is prerendered per locale at build time.
// Request-time data (session, characters) is read only inside <Suspense> boundaries.
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * Public address for absolute metadata URLs (the social preview image).
 * *.vercel.app is blocked on Turkish networks, so links are shared through the
 * Cloudflare Pages mirror (proxy/pages); its previews must load from there too.
 */
const SITE_URL = 'https://ai-sims.pages.dev';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('App');
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: t('name'), template: `%s | ${t('name')}` },
    description: t('description'),
    // The image itself is `opengraph-image.png` next to this layout.
    openGraph: { siteName: t('name'), type: 'website' },
    twitter: { card: 'summary_large_image' },
  };
}

export const viewport: Viewport = {
  themeColor: '#eceae4',
  colorScheme: 'light',
};

export default async function RootLayout({ children }: LayoutProps<'/[locale]'>) {
  const locale = await localeParam();
  if (!hasLocale(routing.locales, locale)) notFound();

  return (
    // suppressHydrationWarning: the inline script adds the `js` class before React hydrates.
    <html
      lang={locale}
      className={`${fontVariables} h-full antialiased`}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        {/* Runs before first paint: lets CSS hide titles that JS is about to reveal. */}
        <InlineScript html="document.documentElement.classList.add('js')" />
      </head>
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider>
          <AppProviders>{children}</AppProviders>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
