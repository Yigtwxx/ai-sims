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
        <span className="text-label text-ink-muted shrink-0 whitespace-nowrap tabular-nums">
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
                      'rounded-tile text-ui inline-flex h-9 items-center gap-2 border px-3 transition-colors duration-200 disabled:opacity-40',
                      on
                        ? 'border-marquee bg-backstage-lift text-ink'
                        : 'border-hairline text-ink-muted hover:border-ink-faint hover:text-ink',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="ring-hairline size-2.5 rounded-full ring-1"
                      style={{ background: def.defaultColor }}
                    />
                    {t(`items.${def.id as ItemKey}`)}
                    {on ? <CheckIcon weight="bold" className="text-marquee size-3.5" /> : null}
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
