import { PlusIcon } from '@phosphor-icons/react/dist/ssr';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { getFormatter, getTranslations } from 'next-intl/server';
import { useTranslations } from 'next-intl';

import { CharacterCard } from '@/components/characters/CharacterCard';
import { PageTransition } from '@/components/shell/PageTransition';
import { StagePoster } from '@/components/stage/StagePoster';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from '@/i18n/navigation';
import { requireUserId } from '@/lib/auth/session';
import { listCharacters } from '@/lib/characters/repository';

// The static shell (heading) is prerendered; the session and the character
// list are request-time data and stream in behind <Suspense>.
export default function CharactersPage() {
  const t = useTranslations('Characters');

  return (
    <PageTransition>
      <div className="mx-auto w-full max-w-[1440px] px-5 pt-[calc(var(--header-h)+3.5rem)] pb-28 md:px-8 lg:px-12">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="font-headline text-headline text-ink">{t('title')}</h1>
            <p className="text-lede text-ink-muted mt-3 max-w-[52ch]">{t('lede')}</p>
          </div>
          <Button asChild variant="quiet" size="default">
            <Link href="/create">
              <PlusIcon aria-hidden="true" />
              {t('newCharacter')}
            </Link>
          </Button>
        </div>
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
      <div className="grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="flex flex-col gap-3">
            <Skeleton className="aspect-[3/4] w-full" />
            <Skeleton className="h-4 w-2/3 rounded-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

async function CharacterList() {
  // Request-time only: stop prerendering before the auth client is created.
  await connection();
  const t = await getTranslations('Characters');
  const format = await getFormatter();
  // The proxy only checks the cookie; this is the authoritative check.
  const userId = await requireUserId();
  const characters = await listCharacters(userId);
  const now = new Date();

  if (characters.length === 0) {
    return (
      <section className="rounded-tile border-hairline relative isolate mt-12 flex min-h-[420px] flex-col items-start justify-end overflow-hidden border px-6 py-10 md:px-12 md:py-14">
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 [--stage-floor:78%] [--stage-x:72%]"
        >
          <StagePoster />
        </div>
        <h2 className="font-headline text-headline text-ink">{t('empty.title')}</h2>
        <p className="text-body text-ink-muted mt-3 max-w-[44ch]">{t('empty.body')}</p>
        <Button asChild variant="primary" size="lg" className="mt-8">
          <Link href="/create">{t('empty.cta')}</Link>
        </Button>
      </section>
    );
  }

  return (
    <>
      <p className="text-label text-ink-faint mt-10 tabular-nums">
        {t('count', { count: characters.length })}
      </p>
      <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-4 xl:grid-cols-5">
        {characters.map((character) => (
          <CharacterCard
            key={character.id}
            character={{
              id: character.id,
              name: character.name,
              status: character.status,
              hasThumbnail: character.hasThumbnail,
              updated: format.relativeTime(character.updatedAt, now),
            }}
          />
        ))}
      </ul>
    </>
  );
}
