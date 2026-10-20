import { connection } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { PageTransition } from '@/components/shell/PageTransition';
import { requireUserId } from '@/lib/auth/session';

// Placeholder while the MetaHuman creator is assembled; it replaces the VRM creator.
export default async function CreatePage() {
  const t = await getTranslations('Creator');
  return (
    <PageTransition>
      <Suspense>
        <AuthGate />
      </Suspense>
      <main className="grid min-h-dvh place-items-center px-6 text-center">
        <p className="text-ink-muted max-w-md text-balance">{t('preparing')}</p>
      </main>
    </PageTransition>
  );
}

/** Authoritative session check (the proxy only looks at the cookie). Renders nothing. */
async function AuthGate() {
  // Request-time only: stop prerendering before the auth client is created.
  await connection();
  await requireUserId();
  return null;
}
