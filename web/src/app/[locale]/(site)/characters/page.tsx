import { connection } from 'next/server';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { useTranslations } from 'next-intl';

import { PageTransition } from '@/components/shell/PageTransition';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from '@/i18n/navigation';
import { requireUserId } from '@/lib/auth/session';
import { listCharacters } from '@/lib/characters/repository';

// The static shell (heading) is prerendered; the session and the character
// list are request-time data and stream in behind <Suspense>.
// Light restyle only: the full "Karakterlerim" design lands with W3.
export default function CharactersPage() {
  const t = useTranslations('Characters');

  return (
    <PageTransition>
      <div className="mx-auto w-full max-w-[1440px] px-5 pt-[calc(var(--header-h)+3.5rem)] pb-28 md:px-8 lg:px-12">
        <h1 className="font-headline text-headline text-ink">{t('title')}</h1>
        <p className="text-lede text-ink-muted mt-3 max-w-[52ch]">{t('lede')}</p>
        <Suspense fallback={<CharacterListSkeleton label={t('loading')} />}>
          <CharacterList />
        </Suspense>
      </div>
    </PageTransition>
  );
}

function CharacterListSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="mt-12">
      <span className="sr-only">{label}</span>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="aspect-[3/4] w-full" />
        ))}
      </div>
    </div>
  );
}

async function CharacterList() {
  // Request-time only: stop prerendering before the auth client is created.
  await connection();
  const t = await getTranslations('Characters');
  // The proxy only checks the cookie; this is the authoritative check.
  const userId = await requireUserId();
  const characters = await listCharacters(userId);

  if (characters.length === 0) {
    return (
      <section className="rounded-tile border-hairline bg-backstage-raised mt-12 flex flex-col items-start gap-6 border px-6 py-10 md:px-10">
        <p className="text-title text-ink">{t('empty')}</p>
        <Button asChild variant="primary" size="lg">
          <Link href="/create">{t('createFirst')}</Link>
        </Button>
      </section>
    );
  }

  return (
    <ul className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {characters.map((character) => (
        <li key={character.id} className="group">
          <div className="rounded-tile bg-backstage-raised relative aspect-[3/4] overflow-hidden">
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_30%,rgb(255_226_176/0.12),transparent_70%)]"
            />
            {character.hasThumbnail ? (
              // Private, session-gated image: next/image optimization does not apply.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/characters/${character.id}/thumbnail`}
                alt=""
                width={360}
                height={480}
                loading="lazy"
                className="ease-out-expo relative size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
              />
            ) : null}
          </div>
          <p className="text-title text-ink mt-3 truncate">{character.name || t('untitled')}</p>
          <p className="text-label text-ink-faint mt-0.5">
            {t(`status.${character.status}`)} · {t(`style.${character.style}`)}
          </p>
        </li>
      ))}
    </ul>
  );
}
