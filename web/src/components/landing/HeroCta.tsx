'use client';

import { ArrowRightIcon, PlayIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';

import { EnterForm } from '@/components/EnterForm';
import { Magnetic } from '@/components/motion/Magnetic';
import { Button } from '@/components/ui/button';

/**
 * The primary action ("Karakterini oluştur": signs in if needed, then opens
 * the creator) with a magnetic pull, plus the secondary "hear it speak" jump.
 */
export function HeroCta({ talkAnchor }: { talkAnchor: string }) {
  const t = useTranslations('Landing.hero');

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-4">
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
      <Button asChild variant="ghost" size="lg" className="text-ink-muted -ml-3 px-3">
        <a href={`#${talkAnchor}`}>
          <PlayIcon weight="fill" aria-hidden="true" className="text-marquee size-4" />
          {t('listen')}
        </a>
      </Button>
    </div>
  );
}
