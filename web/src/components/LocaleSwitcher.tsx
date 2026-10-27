'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Suspense } from 'react';

import { Link, usePathname } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { cn } from '@/lib/utils';

/**
 * Two-item segmented control ("TR" / "EN") that keeps the current path.
 * The path is request data on dynamic routes (Cache Components), so the
 * path-aware links render inside their own boundary; the fallback links point
 * at each locale's home.
 */
export function LocaleSwitcher({ className }: { className?: string }) {
  const t = useTranslations('LocaleSwitcher');

  return (
    <nav aria-label={t('label')} className={className}>
      <Suspense fallback={<LocaleLinks pathname="/" />}>
        <CurrentPathLocaleLinks />
      </Suspense>
    </nav>
  );
}

function CurrentPathLocaleLinks() {
  return <LocaleLinks pathname={usePathname()} />;
}

function LocaleLinks({ pathname }: { pathname: string }) {
  const t = useTranslations('LocaleSwitcher');
  const currentLocale = useLocale();

  return (
    <ul className="rounded-control border-hairline flex w-fit items-center border p-0.5">
      {routing.locales.map((locale) => {
        const active = locale === currentLocale;
        return (
          <li key={locale}>
            <Link
              href={pathname}
              locale={locale}
              lang={locale}
              hrefLang={locale}
              aria-current={active ? 'true' : undefined}
              aria-label={t(locale)}
              className={cn(
                'rounded-tile text-label flex h-8 min-w-9 items-center justify-center px-2 font-semibold tracking-[0.02em] transition-colors duration-200',
                active ? 'bg-paper-lift text-ink' : 'text-ink-faint hover:text-ink',
              )}
            >
              {t(`short.${locale}`)}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
