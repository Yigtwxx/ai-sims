import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { locale as localeParam } from 'next/root-params';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
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

export default async function RootLayout({ children }: LayoutProps<'/[locale]'>) {
  const locale = await localeParam();
  if (!hasLocale(routing.locales, locale)) notFound();

  return (
    <html lang={locale} className={`${fontVariables} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
