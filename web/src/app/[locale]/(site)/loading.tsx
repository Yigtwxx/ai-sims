import { useTranslations } from 'next-intl';

import { Skeleton } from '@/components/ui/skeleton';

/** Instant route fallback: the page's title block and a content strip, lit by a slow sweep. */
export default function Loading() {
  const t = useTranslations('Status');

  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto w-full max-w-[1440px] px-5 pt-[calc(var(--header-h)+4rem)] pb-24 md:px-8 lg:px-12"
    >
      <span className="sr-only">{t('loading')}</span>
      <Skeleton className="h-12 w-[min(28rem,80%)]" />
      <Skeleton className="mt-4 h-5 w-[min(36rem,92%)]" />
      <div className="mt-14 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="aspect-[3/4] w-full" />
        ))}
      </div>
    </div>
  );
}
