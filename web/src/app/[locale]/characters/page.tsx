import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import { SignOutForm } from '@/components/SignOutForm';
import { Link } from '@/i18n/navigation';
import { requireUserId } from '@/lib/auth/session';
import { listCharacters } from '@/lib/characters/repository';

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
  const t = await getTranslations('Characters');
  // The proxy only checks the cookie; this is the authoritative check.
  const userId = await requireUserId();
  const characters = await listCharacters(userId);

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
          {character.hasThumbnail ? (
            // Private, session-gated image: next/image optimization does not apply.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/characters/${character.id}/thumbnail`}
              alt=""
              width={64}
              height={64}
              loading="lazy"
            />
          ) : null}
          <span>{character.name}</span> <span>{t(`style.${character.style}`)}</span>{' '}
          <span>{t(`status.${character.status}`)}</span>
        </li>
      ))}
    </ul>
  );
}
