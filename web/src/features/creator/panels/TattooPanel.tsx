'use client';

import { PlusIcon, XIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import {
  MAX_TATTOOS,
  TATTOO_ART,
  TATTOO_DESIGNS,
  TATTOO_PLACEMENTS,
  isTattooDesign,
  isTattooPlacement,
  type TattooDesign,
  type TattooPlacement,
} from '../tattoos';
import { ChipRadio, Hint, Section } from '../ui/controls';

import { useConfig } from './shared';

/** A design drawn with the lines the stage paints as ink. */
function TattooGlyph({ design, className }: { design: TattooDesign; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" className={className}>
      {TATTOO_ART[design].map((d) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.25}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

/**
 * The picked placement lives with the editor: the stage frames it and shows
 * it through the clothes while this panel is open.
 */
export function TattooPanel({
  placement,
  onPlacementChange,
}: {
  placement: TattooPlacement;
  onPlacementChange: (placement: TattooPlacement) => void;
}) {
  const t = useTranslations('Creator.tattoos');
  const { config, update } = useConfig();
  const [design, setDesign] = useState<TattooDesign>('star');

  const taken = new Set(config.tattoos.map((tattoo) => tattoo.placement));
  const full = config.tattoos.length >= MAX_TATTOOS;
  const blocked = taken.has(placement);

  return (
    <>
      <Section title={t('design')}>
        <div role="radiogroup" aria-label={t('design')} className="grid grid-cols-4 gap-2.5">
          {TATTOO_DESIGNS.map((id) => {
            const active = id === design;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setDesign(id)}
                className={cn(
                  'rounded-tile flex aspect-square flex-col items-center justify-center gap-1.5 transition-[background-color,color,box-shadow,scale] duration-200 active:scale-[0.97] active:duration-100',
                  active
                    ? 'bg-paper-lift text-ink shadow-[inset_0_0_0_2px_var(--color-ink)]'
                    : 'text-ink-muted hover:text-ink shadow-[inset_0_0_0_1px_rgb(23_26_33/0.12)] hover:shadow-[inset_0_0_0_1px_rgb(23_26_33/0.35)]',
                )}
              >
                <TattooGlyph design={id} className="size-8" />
                <span className={cn('text-label', active && 'font-semibold')}>
                  {t(`designs.${id}`)}
                </span>
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
          onChange={onPlacementChange}
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
              const designName = t(`designs.${tattoo.design}`);
              return (
                <li key={tattoo.placement} className="flex items-center gap-3 px-3 py-2">
                  <TattooGlyph design={tattoo.design} className="text-ink-muted size-6" />
                  {/* Picking an added tattoo frames it on the stage. */}
                  <button
                    type="button"
                    aria-pressed={tattoo.placement === placement}
                    onClick={() => onPlacementChange(tattoo.placement as TattooPlacement)}
                    className={cn(
                      'text-ui flex-1 text-left transition-colors duration-200',
                      tattoo.placement === placement
                        ? 'text-ink font-semibold'
                        : 'text-ink-muted hover:text-ink',
                    )}
                  >
                    {t('entry', {
                      design: designName,
                      placement: t(`placements.${tattoo.placement}`),
                    })}
                  </button>
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
