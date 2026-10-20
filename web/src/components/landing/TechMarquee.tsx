import { useTranslations } from 'next-intl';

import { ScrollVelocity } from '@/components/reactbits/ScrollVelocity';

/** The single marquee on the page: what the demo is built on, drifting with the scroll. */
export function TechMarquee() {
  const t = useTranslations('Landing.marquee');
  const items = t.raw('items') as string[];

  return (
    <section aria-label={t('label')} className="border-hairline/70 border-y py-7 md:py-9">
      <ScrollVelocity velocity={34} copies={4}>
        <ul className="flex items-center">
          {items.map((item) => (
            <li key={item} className="font-headline text-headline text-ink-faint flex items-center">
              <span className="px-[0.55em]">{item}</span>
              <span aria-hidden="true" className="text-marquee/70">
                ·
              </span>
            </li>
          ))}
        </ul>
      </ScrollVelocity>
    </section>
  );
}
