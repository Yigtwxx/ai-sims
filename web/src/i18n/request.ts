import { notFound } from 'next/navigation';
import { locale as localeParam } from 'next/root-params';
import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

export default getRequestConfig(async ({ locale }) => {
  if (!locale) {
    const fromParams = await localeParam();
    if (!hasLocale(routing.locales, fromParams)) notFound();
    locale = fromParams;
  }

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
