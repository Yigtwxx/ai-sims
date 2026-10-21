'use client';

import { useTranslations } from 'next-intl';

import { HAIR_PATTERNS } from '@/lib/character/schema';

import { HAIR_DYES, HAIR_PATTERN_COLORS, naturalHairColor } from '../palettes';
import { groomsFor } from '../reconcile';
import { thumbnailSrc } from '../useMhManifest';
import { OptionGrid, OptionTile } from '../ui/OptionGrid';
import { ChipRadio, LabeledSlider, Section, SwatchPicker } from '../ui/controls';

import { useConfig, useLabel, type PanelProps } from './shared';

export function HairPanel({ manifest }: PanelProps) {
  const t = useTranslations('Creator.hair');
  const colors = useTranslations('Creator.colors');
  const label = useLabel();
  const { config, update } = useConfig();

  const styles = groomsFor(manifest, 'hair', config.base);
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
      <Section title={t('styles')} aside={styles.length}>
        <OptionGrid label={t('styles')}>
          <OptionTile
            label={t('none')}
            none
            selected={config.hair.style === null}
            onSelect={() => update((draft) => void (draft.hair.style = null))}
          />
          {styles.map((groom) => (
            <OptionTile
              key={groom.id}
              label={label(groom.label)}
              image={thumbnailSrc(groom.thumbnail)}
              selected={config.hair.style === groom.id}
              onSelect={() => update((draft) => void (draft.hair.style = groom.id))}
            />
          ))}
        </OptionGrid>
      </Section>

      <Section title={t('natural')}>
        <div className="flex flex-col gap-5">
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
      </Section>

      <Section title={t('pattern')}>
        <ChipRadio
          label={t('pattern')}
          value={pattern.type}
          options={HAIR_PATTERNS.map((type) => ({ value: type, label: t(`patterns.${type}`) }))}
          onChange={(type) => update((draft) => void (draft.hair.pattern.type = type))}
        />
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
