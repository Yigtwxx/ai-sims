import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { devToolsEnabled } from '@/components/dev/devTools';
import { CurationScreen } from '@/components/curation/CurationScreen';
import { PageTransition } from '@/components/shell/PageTransition';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Curate');
  return { title: t('title'), robots: { index: false, follow: false } };
}

/** Asset curation: `next dev` only. In a production build the route does not exist (404). */
export default function CuratePage() {
  return (
    <PageTransition>
      <Suspense>
        <CurationGate />
      </Suspense>
    </PageTransition>
  );
}

async function CurationGate() {
  // Request-time only: decided per request, never baked into a prerender.
  await connection();
  if (!devToolsEnabled()) notFound();
  return <CurationScreen />;
}
