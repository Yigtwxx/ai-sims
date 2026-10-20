import { useLocale, useTranslations } from 'next-intl';
import { signOutAction } from '@/lib/auth/actions';

export function SignOutForm() {
  const t = useTranslations('Nav');
  const locale = useLocale();

  return (
    <form action={signOutAction}>
      <input type="hidden" name="locale" value={locale} />
      <button type="submit">{t('signOut')}</button>
    </form>
  );
}
