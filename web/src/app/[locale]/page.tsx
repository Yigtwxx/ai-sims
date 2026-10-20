import { useTranslations } from 'next-intl';
import { EnterForm } from '@/components/EnterForm';

export default function LandingPage() {
  const t = useTranslations('Landing');

  return (
    <main>
      <h1>{t('title')}</h1>
      <p>{t('subtitle')}</p>
      <EnterForm />
    </main>
  );
}
