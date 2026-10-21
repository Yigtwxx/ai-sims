import { connection } from 'next/server';
import { Suspense } from 'react';

import { PageTransition } from '@/components/shell/PageTransition';
import { CreatorScreen } from '@/features/creator/CreatorScreen';
import { requireUserId } from '@/lib/auth/session';

/** New character: the creator starts from a default for the manifest's first face. */
export default function CreatePage() {
  return (
    <PageTransition>
      <Suspense>
        <AuthGate />
      </Suspense>
      <CreatorScreen />
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
