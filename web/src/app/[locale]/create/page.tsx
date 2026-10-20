import { Suspense } from 'react';

import { CreatorScreen } from '@/features/creator/CreatorScreen';
import { requireUserId } from '@/lib/auth/session';

// The creator is a client experience; the session check streams in behind <Suspense>.
export default function CreatePage() {
  return (
    <>
      <Suspense>
        <AuthGate />
      </Suspense>
      <CreatorScreen />
    </>
  );
}

/** Authoritative session check (the proxy only looks at the cookie). Renders nothing. */
async function AuthGate() {
  await requireUserId();
  return null;
}
