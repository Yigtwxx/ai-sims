import { Suspense } from 'react';
import { getLocale, getTranslations } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import { SignOutForm } from '@/components/SignOutForm';
import { Link, redirect } from '@/i18n/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { listCharacters } from '@/lib/characters/repository';
import { createClient } from '@/lib/supabase/server';

// The static shell (heading, sign-out) is prerendered; the session and the
// character list are request-time data and stream in behind <Suspense>.
export default function CharactersPage() {
  const t = useTranslations('Characters');

  return (
    <main>
      <h1>{t('title')}</h1>
      <SignOutForm />
      <Suspense fallback={<p>{t('loading')}</p>}>
        <CharacterList />
      </Suspense>
    </main>
  );
}

async function CharacterList() {
  const [t, locale, user] = await Promise.all([
    getTranslations('Characters'),
    getLocale(),
    getSessionUser(),
  ]);
  // The proxy already redirects signed-out users; this is the authoritative check.
  if (!user) redirect({ href: '/', locale });

  const characters = await listCharacters(await createClient());

  if (characters.length === 0) {
    return (
      <section>
        <p>{t('empty')}</p>
        <Link href="/create">{t('createFirst')}</Link>
      </section>
    );
  }

  return (
    <ul>
      {characters.map((character) => (
        <li key={character.id}>
          <span>{character.name}</span> <span>{t(`status.${character.status}`)}</span>
        </li>
      ))}
    </ul>
  );
}
