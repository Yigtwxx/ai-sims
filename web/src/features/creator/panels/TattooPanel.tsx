'use client';

import {
  BirdIcon,
  CompassIcon,
  FeatherIcon,
  HeartIcon,
  LeafIcon,
  MoonIcon,
  PlusIcon,
  StarIcon,
  WavesIcon,
  XIcon,
  type Icon,
} from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import {
  MAX_TATTOOS,
  TATTOO_DESIGNS,
  TATTOO_PLACEMENTS,
  isTattooDesign,
  isTattooPlacement,
  type TattooDesign,
  type TattooPlacement,
} from '../tattoos';
import { ChipRadio, Hint, Section } from '../ui/controls';

import { useConfig } from './shared';

/** Line glyphs stand in for the fine-line designs until their decals are baked. */
const DESIGN_GLYPHS: Record<TattooDesign, Icon> = {
  wave: WavesIcon,
  star: StarIcon,
  moon: MoonIcon,
  leaf: LeafIcon,
  bird: BirdIcon,
  heart: HeartIcon,
  feather: FeatherIcon,
  compass: CompassIcon,
};

export function TattooPanel() {
  const t = useTranslations('Creator.tattoos');
  const { config, update } = useConfig();
  const [design, setDesign] = useState<TattooDesign>('star');
  const [placement, setPlacement] = useState<TattooPlacement>('innerWrist');

  const taken = new Set(config.tattoos.map((tattoo) => tattoo.placement));
  const full = config.tattoos.length >= MAX_TATTOOS;
  const blocked = taken.has(placement);

  return (
    <>
      <Section title={t('design')}>
        <div role="radiogroup" aria-label={t('design')} className="grid grid-cols-4 gap-2.5">
          {TATTOO_DESIGNS.map((id) => {
            const Glyph = DESIGN_GLYPHS[id];
            const active = id === design;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setDesign(id)}
                className={cn(
                  'rounded-tile flex aspect-square flex-col items-center justify-center gap-1.5 border transition-colors duration-200',
                  active
                    ? 'border-marquee bg-backstage-lift text-ink'
                    : 'border-hairline text-ink-muted hover:border-ink-faint hover:text-ink',
                )}
              >
                <Glyph weight="thin" className="size-8" aria-hidden="true" />
                <span className="text-label">{t(`designs.${id}`)}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title={t('placement')}>
        <ChipRadio
          label={t('placement')}
          value={placement}
          options={TATTOO_PLACEMENTS.map((id) => ({ value: id, label: t(`placements.${id}`) }))}
          onChange={setPlacement}
        />
        {blocked ? <Hint>{t('taken')}</Hint> : null}
        <Button
          type="button"
          variant="quiet"
          size="sm"
          className="self-start"
          disabled={full || blocked}
          onClick={() => update((draft) => void draft.tattoos.push({ design, placement }))}
        >
          <PlusIcon aria-hidden="true" />
          {t('add')}
        </Button>
        {full ? <Hint>{t('limit', { max: MAX_TATTOOS })}</Hint> : null}
      </Section>

      <Section title={t('list')} aside={`${config.tattoos.length}/${MAX_TATTOOS}`}>
        {config.tattoos.length === 0 ? (
          <Hint>{t('empty')}</Hint>
        ) : (
          <ul className="divide-hairline rounded-tile border-hairline flex flex-col divide-y border">
            {config.tattoos.map((tattoo) => {
              if (!isTattooDesign(tattoo.design) || !isTattooPlacement(tattoo.placement)) {
                return null;
              }
              const Glyph = DESIGN_GLYPHS[tattoo.design];
              const designName = t(`designs.${tattoo.design}`);
              return (
                <li key={tattoo.placement} className="flex items-center gap-3 px-3 py-2">
                  <Glyph weight="thin" className="text-ink-muted size-6" aria-hidden="true" />
                  <span className="text-ui text-ink flex-1">
                    {t('entry', {
                      design: designName,
                      placement: t(`placements.${tattoo.placement}`),
                    })}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('remove', { design: designName })}
                    onClick={() =>
                      update(
                        (draft) =>
                          void (draft.tattoos = draft.tattoos.filter(
                            (item) => item.placement !== tattoo.placement,
                          )),
                      )
                    }
                  >
                    <XIcon aria-hidden="true" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </>
  );
}
