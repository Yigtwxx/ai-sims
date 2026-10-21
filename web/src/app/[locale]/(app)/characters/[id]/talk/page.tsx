import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { PageTransition } from '@/components/shell/PageTransition';
import { TalkFallback } from '@/components/shell/TalkFallback';
import { TalkScreen } from '@/features/talk/TalkScreen';
import { requireUserId } from '@/lib/auth/session';
import { getCharacter } from '@/lib/characters/repository';

/** Talk to a saved character: it stands full height on the left, the chat sits on the right. */
export default function TalkPage({ params }: PageProps<'/[locale]/characters/[id]/talk'>) {
  return (
    <PageTransition>
      <Suspense fallback={<TalkFallback />}>
        <TalkLoader params={params} />
      </Suspense>
    </PageTransition>
  );
}

async function TalkLoader({ params }: Pick<PageProps<'/[locale]/characters/[id]/talk'>, 'params'>) {
  // Request-time only: the session and the character are per request.
  await connection();
  const { id } = await params;
  const userId = await requireUserId();
  const character = await getCharacter(userId, id);
  if (!character) notFound();
  return (
    <TalkScreen character={{ id: character.id, name: character.name, config: character.config }} />
  );
}
