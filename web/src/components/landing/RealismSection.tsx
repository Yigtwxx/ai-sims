'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { SplitText } from '@/components/reactbits/SplitText';
import { CloseUpStage } from '@/components/stage/CloseUpStage';
import { cn } from '@/lib/utils';

import type { EyeFocus } from './eye/EyeMacro';

const LAYERS = ['skin', 'eyes', 'hair', 'light'] as const satisfies readonly EyeFocus[];

/**
 * Realism close-up. Desktop: the close-up frame stays pinned (sticky) on the
 * right while the four realism layers scroll past on the left; the layer in
 * the middle of the viewport is "in focus" and the close-up responds.
 * Mobile: the frame comes first, the layers follow as a short list.
 */
export function RealismSection({ closeUp }: { closeUp?: React.ReactNode }) {
  const t = useTranslations('Landing.realism');
  const [focus, setFocus] = useState<EyeFocus>('eyes');
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const items = list.current?.querySelectorAll<HTMLElement>('[data-layer]');
    if (!items?.length) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const hit = entries.find((entry) => entry.isIntersecting);
        const layer = hit?.target.getAttribute('data-layer') as EyeFocus | null | undefined;
        if (layer) setFocus(layer);
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);

  return (
    <section
      aria-labelledby="realism-title"
      className="py-section mx-auto max-w-[1440px] px-5 md:px-8 lg:px-12"
    >
      <div className="grid gap-12 lg:grid-cols-12 lg:gap-x-12">
        <div className="lg:col-span-5">
          <SplitText
            as="h2"
            id="realism-title"
            text={t('title')}
            className="font-headline text-headline text-ink max-w-[14ch]"
          />
          <p className="text-lede text-ink-muted mt-5 max-w-[44ch]">{t('lede')}</p>

          <ol ref={list} className="mt-12 lg:mt-24">
            {LAYERS.map((layer) => {
              const active = layer === focus;
              return (
                <li
                  key={layer}
                  data-layer={layer}
                  aria-current={active ? 'step' : undefined}
                  className="border-hairline relative border-t pt-6 pb-10 lg:min-h-[42vh] lg:last:min-h-0 lg:last:pb-0"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'bg-marquee ease-out-expo absolute -top-px left-0 h-px w-full origin-left transition-transform duration-700',
                      active ? 'scale-x-100' : 'scale-x-0',
                    )}
                  />
                  <h3
                    className={cn(
                      'font-headline text-subhead transition-colors duration-500',
                      active ? 'text-ink' : 'text-ink-faint',
                    )}
                  >
                    {t(`layers.${layer}.title`)}
                  </h3>
                  <p
                    className={cn(
                      'text-body mt-3 max-w-[40ch] transition-colors duration-500',
                      active ? 'text-ink-muted' : 'text-ink-faint',
                    )}
                  >
                    {t(`layers.${layer}.body`)}
                  </p>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="order-first self-start lg:sticky lg:top-[calc(var(--header-h)+2.5rem)] lg:order-none lg:col-span-7">
          <CloseUpStage
            label={t('stageLabel')}
            focus={focus}
            className="aspect-[4/5] w-full lg:aspect-auto lg:h-[min(78vh,820px)]"
          >
            {closeUp}
          </CloseUpStage>
        </div>
      </div>
    </section>
  );
}
