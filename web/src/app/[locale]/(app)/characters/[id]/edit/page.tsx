import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { PageTransition } from '@/components/shell/PageTransition';
import { CreatorFallback } from '@/components/shell/CreatorFallback';
import { CreatorScreen } from '@/features/creator/CreatorScreen';
import { requireUserId } from '@/lib/auth/session';
import { getCharacter } from '@/lib/characters/repository';

/** Edit a saved character: the creator opens with its stored (migrated) config. */
export default function EditCharacterPage({ params }: PageProps<'/[locale]/characters/[id]/edit'>) {
  return (
    <PageTransition>
      <Suspense fallback={<CreatorFallback />}>
        <EditLoader params={params} />
      </Suspense>
    </PageTransition>
  );
}

async function EditLoader({ params }: Pick<PageProps<'/[locale]/characters/[id]/edit'>, 'params'>) {
  // Request-time only: the session and the character are per request.
  await connection();
  const { id } = await params;
  const userId = await requireUserId();
  const character = await getCharacter(userId, id);
  if (!character) notFound();
  return (
    <CreatorScreen
      initial={{
        id: character.id,
        name: character.name,
        config: character.config,
        status: character.status,
      }}
    />
  );
}
