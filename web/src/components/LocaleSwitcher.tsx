'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';

export function LocaleSwitcher() {
  const t = useTranslations('LocaleSwitcher');
  const currentLocale = useLocale();
  const pathname = usePathname();

  return (
    <nav aria-label={t('label')}>
      <ul>
        {routing.locales.map((locale) => (
          <li key={locale}>
            <Link
              href={pathname}
              locale={locale}
              lang={locale}
              aria-current={locale === currentLocale ? 'true' : undefined}
            >
              {t(locale)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
