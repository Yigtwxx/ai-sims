'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { HAIR_PATTERNS } from '@/lib/character/schema';

import { HAIR_DYES, HAIR_PATTERN_COLORS, naturalHairColor } from '../palettes';
import { HAIR_LENGTHS, hairLength, type HairLength } from '../hairLength';
import { groomsFor } from '../reconcile';
import { thumbnailSrc } from '../useMhManifest';
import { OptionList, type OptionListItem } from '../ui/OptionList';
import {
  ChipRadio,
  Hint,
  LabeledSlider,
  PressedPills,
  Section,
  SwatchPicker,
} from '../ui/controls';

import { useConfig, useLabel, type PanelProps } from './shared';

export function HairPanel({ manifest }: PanelProps) {
  const t = useTranslations('Creator.hair');
  const colors = useTranslations('Creator.colors');
  const label = useLabel();
  const { config, update } = useConfig();
  // A view filter, not part of the character: it never changes the pick.
  const [length, setLength] = useState<HairLength | 'all'>('all');

  const styles = groomsFor(manifest, 'hair', config.base);
  const lengths = new Map(styles.map((groom) => [groom.id, hairLength(groom.id)]));
  // Only a library whose grooms carry their length gets the filter.
  const filterable = [...lengths.values()].some(Boolean);
  const shown =
    length === 'all' ? styles : styles.filter((groom) => lengths.get(groom.id) === length);
  const items: OptionListItem[] = [
    // "No hair" belongs to no length.
    ...(length === 'all' ? [{ value: null, label: t('none') }] : []),
    ...shown.map((groom) => {
      const groomLength = lengths.get(groom.id);
      return {
        value: groom.id,
        label: label(groom.label),
        meta: groomLength ? t(`lengths.${groomLength}`) : undefined,
        image: thumbnailSrc(groom.thumbnail),
      };
    }),
  ];
  const { melanin, redness, dye } = config.hair.color;
  const natural = naturalHairColor(melanin, redness);
  const pattern = config.hair.pattern;
  const preview = (
    <span
      aria-hidden="true"
      className="ring-hairline size-4 rounded-full ring-1"
      style={{ background: dye ?? natural }}
    />
  );

  return (
    <>
      <Section
        title={t('styles')}
        aside={length === 'all' ? styles.length : `${shown.length}/${styles.length}`}
      >
        {filterable ? (
          <PressedPills
            label={t('lengthFilter')}
            value={length}
            options={(['all', ...HAIR_LENGTHS] as const).map((value) => ({
              value,
              label: t(`lengths.${value}`),
            }))}
            onChange={setLength}
            className="mb-1 self-start"
          />
        ) : null}
        {/* Remounts per filter: the new rows stagger in and the list opens on its pick. */}
        <OptionList
          key={length}
          label={t('styles')}
          items={items}
          value={config.hair.style}
          onChange={(style) => update((draft) => void (draft.hair.style = style))}
          revealSelected={length === 'all'}
        />
        {items.length === 0 ? <Hint>{t('noneOfLength')}</Hint> : null}
      </Section>

      <Section title={t('natural')}>
        <div className="flex flex-col gap-4">
          <LabeledSlider
            label={t('melanin')}
            value={melanin}
            min={0}
            max={1}
            ends={[t('blond'), t('black')]}
            valueText={`${Math.round(melanin * 100)}%`}
            adornment={preview}
            onChange={(value) => update((draft) => void (draft.hair.color.melanin = value))}
          />
          <LabeledSlider
            label={t('redness')}
            value={redness}
            min={0}
            max={1}
            ends={[t('neutral'), t('red')]}
            valueText={`${Math.round(redness * 100)}%`}
            onChange={(value) => update((draft) => void (draft.hair.color.redness = value))}
          />
        </div>
      </Section>

      <Section title={t('dye')}>
        <SwatchPicker
          label={t('dye')}
          size="sm"
          noneLabel={t('noDye')}
          colors={HAIR_DYES.map((color) => ({ value: color.value, label: colors(color.key) }))}
          value={dye}
          onChange={(value) => update((draft) => void (draft.hair.color.dye = value))}
        />
        <Hint>{t('dyeHint')}</Hint>
      </Section>

      <Section title={t('pattern')}>
        <ChipRadio
          label={t('pattern')}
          value={pattern.type}
          options={HAIR_PATTERNS.map((type) => ({ value: type, label: t(`patterns.${type}`) }))}
          onChange={(type) => update((draft) => void (draft.hair.pattern.type = type))}
        />
        {pattern.type === 'none' ? <Hint>{t('patternHint')}</Hint> : null}
        {pattern.type !== 'none' ? (
          <div className="flex flex-col gap-5 pt-2">
            <SwatchPicker
              label={t('patternColor')}
              size="sm"
              colors={HAIR_PATTERN_COLORS.map((color) => ({
                value: color.value,
                label: colors(color.key),
              }))}
              value={pattern.color}
              onChange={(value) => {
                if (value) update((draft) => void (draft.hair.pattern.color = value));
              }}
            />
            <LabeledSlider
              label={t('amount')}
              value={pattern.amount}
              min={0}
              max={1}
              valueText={`${Math.round(pattern.amount * 100)}%`}
              onChange={(value) => update((draft) => void (draft.hair.pattern.amount = value))}
            />
          </div>
        ) : null}
      </Section>
    </>
  );
}
