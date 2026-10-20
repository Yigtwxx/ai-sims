import { useTranslations } from 'next-intl';
import { SignOutForm } from '@/components/SignOutForm';

export default function CreatePage() {
  const t = useTranslations('Creator');

  return (
    <main>
      <h1>{t('title')}</h1>
      <p>{t('comingSoon')}</p>
      <SignOutForm />
    </main>
  );
}
