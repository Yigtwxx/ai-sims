import { useTranslations } from 'next-intl';

import { SplitText } from '@/components/reactbits/SplitText';

import { ClosingCta } from './ClosingCta';

/** The close: one spot finds the call to action, standing where the character will. */
export function ClosingSection() {
  const t = useTranslations('Landing.closing');

  return (
    <section
      aria-labelledby="closing-title"
      className="py-section relative isolate overflow-hidden"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-0 left-1/2 h-full w-[min(80vw,760px)] -translate-x-1/2 blur-[30px]">
          <div
            className="size-full"
            style={{
              clipPath: 'polygon(44% 0, 56% 0, 100% 100%, 0 100%)',
              background:
                'linear-gradient(to bottom, rgb(255 234 200 / 0.14), rgb(255 226 176 / 0.05) 60%, transparent)',
            }}
          />
        </div>
        <div className="absolute bottom-[18%] left-1/2 h-40 w-[min(84vw,820px)] -translate-x-1/2 bg-[radial-gradient(closest-side,rgb(255_228_184/0.14),transparent)]" />
      </div>

      <div className="mx-auto flex max-w-[1440px] flex-col items-center px-5 text-center md:px-8 lg:px-12">
        <SplitText
          as="h2"
          id="closing-title"
          text={t('title')}
          className="font-display text-display text-ink max-w-[16ch]"
        />
        <p className="text-lede text-ink-muted mt-6 max-w-[44ch]">{t('lede')}</p>
        <div className="mt-10">
          <ClosingCta />
        </div>
      </div>
    </section>
  );
}
