'use client';

import { ArrowRightIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';

import { EnterForm } from '@/components/EnterForm';
import { Magnetic } from '@/components/motion/Magnetic';

/** Same intent and label as the hero action: sign in if needed, then open the creator. */
export function ClosingCta() {
  const t = useTranslations('Landing.hero');

  return (
    <div className="flex flex-col items-center">
      <EnterForm
        next="/create"
        variant="primary"
        size="lg"
        inlineError
        className="group/cta pr-5 pl-6"
        renderButton={(button) => <Magnetic>{button}</Magnetic>}
      >
        {t('cta')}
        <ArrowRightIcon
          weight="bold"
          aria-hidden="true"
          className="ease-out-expo size-[18px] transition-transform duration-300 group-hover/cta:translate-x-1"
        />
      </EnterForm>
    </div>
  );
}
