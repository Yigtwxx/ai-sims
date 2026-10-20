import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { locale as localeParam } from 'next/root-params';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { AppProviders } from '@/components/shell/AppProviders';
import { routing } from '@/i18n/routing';
import { fontVariables } from '@/styles/fonts';
import '../globals.css';

// Rendering strategy: every [locale] route is prerendered per locale at build time.
// Request-time data (session, characters) is read only inside <Suspense> boundaries.
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('App');
  return {
    title: { default: t('name'), template: `%s | ${t('name')}` },
    description: t('description'),
  };
}

export const viewport: Viewport = {
  themeColor: '#121211',
  colorScheme: 'dark',
};

export default async function RootLayout({ children }: LayoutProps<'/[locale]'>) {
  const locale = await localeParam();
  if (!hasLocale(routing.locales, locale)) notFound();

  return (
    // suppressHydrationWarning: the inline script adds the `js` class before React hydrates.
    <html
      lang={locale}
      className={`${fontVariables} dark h-full antialiased`}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        <script
          // Runs before first paint: lets CSS hide titles that JS is about to reveal.
          dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }}
        />
      </head>
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider>
          <AppProviders>{children}</AppProviders>
        </NextIntlClientProvider>
        <div aria-hidden="true" className="film-grain" />
      </body>
    </html>
  );
}
