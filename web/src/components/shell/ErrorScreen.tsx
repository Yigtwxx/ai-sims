'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';

import { StatusScreen } from '@/components/shell/StatusScreen';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

interface ErrorScreenProps {
  error: unknown;
  retry: () => void;
}

/** Localized error boundary UI shared by the route-segment error files. */
export function ErrorScreen({ error, retry }: ErrorScreenProps) {
  const t = useTranslations('Status');
  const digest =
    error instanceof Error && 'digest' in error && typeof error.digest === 'string'
      ? error.digest
      : undefined;

  useEffect(() => {
    // Surface the failure in the console only; server errors arrive without details.
    console.error(error);
  }, [error]);

  return (
    <StatusScreen
      title={t('errorTitle')}
      body={t('errorBody')}
      footnote={digest ? t('errorCode', { digest }) : undefined}
      className="pt-(--header-h)"
    >
      <Button type="button" variant="primary" size="lg" onClick={() => retry()}>
        {t('retry')}
      </Button>
      <Button asChild variant="quiet" size="lg">
        <Link href="/">{t('backHome')}</Link>
      </Button>
    </StatusScreen>
  );
}
