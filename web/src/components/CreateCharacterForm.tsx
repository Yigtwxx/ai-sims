'use client';

import { useActionState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { createCharacterAction, type CreateCharacterState } from '@/lib/characters/actions';
import { CHARACTER_BASES, CHARACTER_STYLES } from '@/lib/character/schema';

export function CreateCharacterForm() {
  const t = useTranslations('Creator');
  const locale = useLocale();
  const [state, formAction, pending] = useActionState<CreateCharacterState, FormData>(
    createCharacterAction,
    null,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="locale" value={locale} />
      <p>
        <label>
          {t('name')} <input name="name" required maxLength={40} />
        </label>
      </p>
      <fieldset>
        <legend>{t('style')}</legend>
        {CHARACTER_STYLES.map((style, index) => (
          <label key={style}>
            <input type="radio" name="style" value={style} defaultChecked={index === 0} />
            {t(`styles.${style}`)}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>{t('base')}</legend>
        {CHARACTER_BASES.map((base, index) => (
          <label key={base}>
            <input type="radio" name="base" value={base} defaultChecked={index === 0} />
            {t(`bases.${base}`)}
          </label>
        ))}
      </fieldset>
      <button type="submit" disabled={pending}>
        {pending ? t('creating') : t('submit')}
      </button>
      {state?.error ? <p role="alert">{t(state.error)}</p> : null}
    </form>
  );
}
