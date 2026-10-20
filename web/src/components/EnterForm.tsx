'use client';

import { useActionState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { signInAnonymouslyAction, type SignInState } from '@/lib/auth/actions';

export function EnterForm() {
  const t = useTranslations('Landing');
  const locale = useLocale();
  const [state, formAction, pending] = useActionState<SignInState, FormData>(
    signInAnonymouslyAction,
    null,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="locale" value={locale} />
      <button type="submit" disabled={pending}>
        {pending ? t('entering') : t('enter')}
      </button>
      {state?.error ? (
        <p role="alert">{t(state.error === 'notConfigured' ? 'notConfigured' : 'signInFailed')}</p>
      ) : null}
    </form>
  );
}
