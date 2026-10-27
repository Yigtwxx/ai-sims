'use client';

import { CheckIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';

import {
  ACCESSORY_SLOTS,
  accessoriesFor,
  findAccessory,
  type AccessoryDef,
} from '@/features/avatar/accessories/catalog';
import { cn } from '@/lib/utils';
import type messages from '../../../../messages/en.json';

import { MAX_ACCESSORIES } from '../reconcile';
import { Hint, Section } from '../ui/controls';

import { useConfig } from './shared';

/** Catalogue ids that have a label in the messages. */
type ItemKey = keyof (typeof messages)['Creator']['jewelry']['items'];

export function JewelryPanel() {
  const t = useTranslations('Creator.jewelry');
  const { config, update } = useConfig();
  const worn = new Set(config.accessories);
  const full = config.accessories.length >= MAX_ACCESSORIES;

  const toggle = (def: AccessoryDef) =>
    update((draft) => {
      if (draft.accessories.includes(def.id)) {
        draft.accessories = draft.accessories.filter((id) => id !== def.id);
        return;
      }
      // One piece per slot: the new pick replaces the old one.
      const others = draft.accessories.filter((id) => findAccessory(id)?.slot !== def.slot);
      if (others.length >= MAX_ACCESSORIES) return;
      draft.accessories = [...others, def.id];
    });

  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <Hint>{t('hint')}</Hint>
        <span className="text-ink-muted shrink-0 font-mono text-[11px] tracking-[0.08em] whitespace-nowrap uppercase tabular-nums">
          {t('count', { count: config.accessories.length, max: MAX_ACCESSORIES })}
        </span>
      </div>
      {full ? <Hint>{t('limit', { max: MAX_ACCESSORIES })}</Hint> : null}

      {ACCESSORY_SLOTS.map((slot) => {
        const items = accessoriesFor(slot);
        const slotTaken = items.some((def) => worn.has(def.id));
        return (
          <Section key={slot} title={t(`slots.${slot}`)}>
            <div role="group" aria-label={t(`slots.${slot}`)} className="flex flex-wrap gap-2">
              {items.map((def) => {
                const on = worn.has(def.id);
                return (
                  <button
                    key={def.id}
                    type="button"
                    aria-pressed={on}
                    disabled={!on && full && !slotTaken}
                    onClick={() => toggle(def)}
                    className={cn(
                      'text-ui inline-flex h-8 items-center gap-2 rounded-full pr-3 pl-2.5 transition-[background-color,color,box-shadow,scale] duration-200 active:scale-[0.97] active:duration-100 disabled:opacity-40',
                      on
                        ? 'bg-paper-lift text-ink shadow-[inset_0_0_0_1.5px_var(--color-ink)]'
                        : 'text-ink-muted hover:text-ink shadow-[inset_0_0_0_1px_rgb(23_26_33/0.18)] hover:shadow-[inset_0_0_0_1px_rgb(23_26_33/0.45)]',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="size-2.5 rounded-full shadow-[inset_0_0_0_1px_rgb(23_26_33/0.2)]"
                      style={{ background: def.defaultColor }}
                    />
                    {t(`items.${def.id as ItemKey}`)}
                    {on ? (
                      <CheckIcon
                        weight="bold"
                        aria-hidden="true"
                        className="text-cobalt animate-mark-in size-3.5"
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </Section>
        );
      })}
    </>
  );
}
