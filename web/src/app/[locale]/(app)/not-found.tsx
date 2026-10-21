import { useTranslations } from 'next-intl';

import { StatusScreen } from '@/components/shell/StatusScreen';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

/** A character id that does not exist or belongs to someone else. */
export default function AppNotFound() {
  const t = useTranslations('Status');
  const nav = useTranslations('Nav');

  return (
    <main>
      <StatusScreen title={t('notFoundTitle')} body={t('notFoundBody')} className="min-h-dvh">
        <Button asChild variant="primary" size="lg">
          <Link href="/characters">{nav('characters')}</Link>
        </Button>
        <Button asChild variant="ghost" size="lg">
          <Link href="/">{t('backHome')}</Link>
        </Button>
      </StatusScreen>
    </main>
  );
}
