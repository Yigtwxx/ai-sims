import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { LocaleSwitcher } from './LocaleSwitcher';

export function SiteHeader() {
  const app = useTranslations('App');
  const t = useTranslations('Nav');

  return (
    <header>
      <Link href="/">{app('name')}</Link>
      <nav aria-label={t('label')}>
        <ul>
          <li>
            <Link href="/characters">{t('characters')}</Link>
          </li>
          <li>
            <Link href="/create">{t('create')}</Link>
          </li>
        </ul>
      </nav>
      <LocaleSwitcher />
    </header>
  );
}
