import { useTranslations } from 'next-intl';

import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { Link } from '@/i18n/navigation';

/**
 * Quiet closing credits: wordmark, one line and language. Navigation lives in the header, which knows the session (protected
 * links here would bounce signed-out visitors). Pages that end on their own
 * closing frame mark it `data-hide-footer` (the landing).
 */
export function SiteFooter() {
  const app = useTranslations('App');
  const nav = useTranslations('Nav');
  const t = useTranslations('Footer');

  return (
    <footer className="border-hairline bg-paper border-t [body:has([data-hide-footer])_&]:hidden">
      <div className="mx-auto grid max-w-[1440px] gap-10 px-5 py-14 md:grid-cols-[1fr_auto] md:items-end md:px-8 lg:px-12">
        <div>
          <Link
            href="/"
            aria-label={`${app('name')}, ${nav('home')}`}
            className="font-wide text-title text-ink font-[640] tracking-[-0.02em]"
          >
            {app('name')}
          </Link>
          <p className="text-body-sm text-ink-muted mt-2 max-w-[40ch]">{t('tagline')}</p>
        </div>

        <LocaleSwitcher className="md:justify-self-end" />
      </div>
    </footer>
  );
}
