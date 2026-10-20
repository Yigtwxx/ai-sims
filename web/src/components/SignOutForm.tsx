'use client';

import { useFormStatus } from 'react-dom';
import { useLocale, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { signOutAction } from '@/lib/auth/actions';

function SignOutButton({ className }: { className?: string }) {
  const t = useTranslations('Nav');
  const session = useTranslations('Session');
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="ghost" size="sm" disabled={pending} className={className}>
      {pending ? session('signingOut') : t('signOut')}
    </Button>
  );
}

export function SignOutForm({ className }: { className?: string }) {
  const locale = useLocale();

  return (
    <form action={signOutAction} className="contents">
      <input type="hidden" name="locale" value={locale} />
      <SignOutButton className={className} />
    </form>
  );
}
