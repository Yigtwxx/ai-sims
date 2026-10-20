import { useTranslations } from 'next-intl';

/** First Tab stop: jumps past the header to the page's main landmark. */
export function SkipLink({ target = 'main' }: { target?: string }) {
  const t = useTranslations('Nav');

  return (
    <a
      href={`#${target}`}
      className="rounded-control bg-marquee text-ui text-backstage ease-out-quint fixed top-3 left-3 z-[60] -translate-y-24 px-4 py-2.5 font-semibold transition-transform duration-200 focus-visible:translate-y-0"
    >
      {t('skipToContent')}
    </a>
  );
}
