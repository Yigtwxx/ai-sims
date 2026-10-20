import { useTranslations } from 'next-intl';

import { StatusScreen } from '@/components/shell/StatusScreen';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

export default function NotFound() {
  const t = useTranslations('Status');

  return (
    <StatusScreen title={t('notFoundTitle')} body={t('notFoundBody')}>
      <Button asChild variant="primary" size="lg">
        <Link href="/">{t('backHome')}</Link>
      </Button>
    </StatusScreen>
  );
}
