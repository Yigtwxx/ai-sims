import { Suspense } from 'react';
import { useTranslations } from 'next-intl';

import { getViewer } from '@/components/session/viewer';
import { Link } from '@/i18n/navigation';

import { HeaderFrame } from './HeaderFrame';
import { HeaderNav } from './HeaderNav';

/**
 * The static header shell (wordmark, frame) is prerendered; the session-aware
 * part streams in behind <Suspense> (Cache Components).
 */
export function SiteHeader() {
  const app = useTranslations('App');
  const nav = useTranslations('Nav');

  return (
    <HeaderFrame>
      <Link
        href="/"
        aria-label={`${app('name')}, ${nav('home')}`}
        className="font-wide rounded-tile text-title text-ink -ml-1 px-1 font-[640] tracking-[-0.02em]"
      >
        {app('name')}
      </Link>
      <Suspense fallback={<HeaderNav viewer={null} />}>
        <HeaderSession />
      </Suspense>
    </HeaderFrame>
  );
}

async function HeaderSession() {
  const viewer = await getViewer();
  return <HeaderNav viewer={viewer} />;
}
