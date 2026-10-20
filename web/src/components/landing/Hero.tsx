import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { SplitText } from '@/components/reactbits/SplitText';
import { HeroStage } from '@/components/stage/HeroStage';

import { HeroCta } from './HeroCta';

interface HeroProps {
  /** Live 3D character for the stage; the lit poster shows until it is provided. */
  stage?: ReactNode;
  talkAnchor: string;
}

/**
 * First viewport: the stage is full bleed under the header; the title card
 * sits bottom-left in the dark part of the frame like opening credits.
 */
export function Hero({ stage, talkAnchor }: HeroProps) {
  const t = useTranslations('Landing.hero');

  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      <HeroStage label={t('stageLabel')} className="-z-10">
        {stage}
      </HeroStage>

      <div className="relative mx-auto flex min-h-[100dvh] max-w-[1440px] flex-col justify-end px-5 pt-[50svh] pb-12 md:px-8 md:pt-[calc(var(--header-h)+2rem)] md:pb-20 lg:px-12 lg:pb-24">
        {/* Mobile: keep the copy off the lit stage by darkening behind it. */}
        <div
          aria-hidden="true"
          className="via-backstage/70 to-backstage pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[62%] bg-linear-to-b from-transparent md:hidden"
        />
        <h1 id="hero-title" className="font-display text-display text-ink max-w-[24ch]">
          <SplitText
            as="span"
            className="block"
            text={t('titleLine1')}
            trigger="load"
            delay={0.55}
          />
          <SplitText
            as="span"
            className="block"
            text={t('titleLine2')}
            trigger="load"
            delay={0.8}
          />
        </h1>
        <p className="animate-rise-in text-lede text-ink-muted mt-5 max-w-[44ch] [animation-delay:1.15s] md:mt-6">
          {t('lede')}
        </p>
        <div className="animate-rise-in mt-7 [animation-delay:1.3s] md:mt-9">
          <HeroCta talkAnchor={talkAnchor} />
        </div>
      </div>
    </section>
  );
}
