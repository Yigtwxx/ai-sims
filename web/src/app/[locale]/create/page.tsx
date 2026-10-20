import { Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { CreateCharacterForm } from '@/components/CreateCharacterForm';
import { SignOutForm } from '@/components/SignOutForm';
import { requireUserId } from '@/lib/auth/session';

// The static shell is prerendered; the session check streams in behind <Suspense>.
export default function CreatePage() {
  const t = useTranslations('Creator');

  return (
    <main>
      <h1>{t('title')}</h1>
      <p>{t('comingSoon')}</p>
      <Suspense>
        <AuthGate />
      </Suspense>
      <CreateCharacterForm />
      <SignOutForm />
    </main>
  );
}

/** Authoritative session check (the proxy only looks at the cookie). Renders nothing. */
async function AuthGate() {
  await requireUserId();
  return null;
}
