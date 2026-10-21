'use client';

import { CoatHangerIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';

import { OUTFIT_CATEGORIES, type OutfitCategory } from '@/lib/assets/manifest';

import { GARMENT_COLORS } from '../palettes';
import { outfitsFor } from '../reconcile';
import { thumbnailSrc } from '../useMhManifest';
import { OptionGrid, OptionTile } from '../ui/OptionGrid';
import { ChipRadio, Hint, Section, SwatchPicker } from '../ui/controls';

import { useConfig, useLabel, type PanelProps } from './shared';

/** The first colour value of a tint preset, used as its swatch. */
const tintColor = (values: Record<string, string | number>) => {
  const color = Object.values(values).find((value) => typeof value === 'string');
  return typeof color === 'string' ? color : undefined;
};

interface OutfitPanelProps extends PanelProps {
  slot: OutfitCategory;
  onSlotChange: (slot: OutfitCategory) => void;
}

export function OutfitPanel({ manifest, slot, onSlotChange }: OutfitPanelProps) {
  const t = useTranslations('Creator.outfit');
  const colors = useTranslations('Creator.colors');
  const label = useLabel();
  const { config, update } = useConfig();

  const options = outfitsFor(manifest, slot, config.base);
  const item = config.outfit[slot];
  const outfit = item ? manifest.outfits.find((candidate) => candidate.id === item.id) : undefined;
  const colorParams = outfit?.params.filter((param) => param.type === 'color') ?? [];

  // A garment goes on in its first (curated) colour, the one its tile shows.
  const choose = (id: string | null) =>
    update((draft) => {
      const tint = options.find((option) => option.id === id)?.tintPresets[0]?.id ?? null;
      draft.outfit[slot] = id ? { id, tint, colors: {} } : null;
      if (id && slot === 'full') {
        draft.outfit.top = null;
        draft.outfit.bottom = null;
      }
      if (id && (slot === 'top' || slot === 'bottom')) draft.outfit.full = null;
    });

  if (manifest.outfits.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 pt-2">
        <CoatHangerIcon weight="thin" className="text-ink-faint size-12" aria-hidden="true" />
        <p className="text-title text-ink">{t('comingSoon')}</p>
        <p className="text-body-sm text-ink-muted">{t('comingSoonBody')}</p>
      </div>
    );
  }

  const paramLabel = (name: string) =>
    name === 'PrimaryColor' || name === 'SecondaryColor' ? t(`params.${name}`) : name;

  return (
    <>
      <ChipRadio
        label={t('slotsLabel')}
        value={slot}
        options={OUTFIT_CATEGORIES.map((category) => ({
          value: category,
          label: t(`slots.${category}`),
        }))}
        onChange={onSlotChange}
      />
      {slot === 'full' ? <Hint>{t('fullReplaces')}</Hint> : null}

      <Section title={t(`slots.${slot}`)} aside={options.length || undefined}>
        {options.length === 0 ? (
          <Hint>{t('empty')}</Hint>
        ) : (
          <OptionGrid label={t(`slots.${slot}`)} revealSelected>
            <OptionTile
              label={t('none')}
              none
              selected={item === null}
              onSelect={() => choose(null)}
            />
            {options.map((option) => (
              <OptionTile
                key={option.id}
                label={label(option.label)}
                image={thumbnailSrc(option.thumbnail)}
                selected={item?.id === option.id}
                swatches={option.tintPresets
                  .map((preset) => tintColor(preset.values))
                  .filter((color): color is string => Boolean(color))}
                onSelect={() => choose(option.id)}
              />
            ))}
          </OptionGrid>
        )}
      </Section>

      {outfit && item && outfit.tintPresets.length > 0 ? (
        <Section title={t('tints')}>
          <SwatchPicker
            label={t('tints')}
            size="sm"
            noneLabel={t('authored')}
            // Presets are picked by id: two presets may share a colour, or have none.
            colors={outfit.tintPresets.map((preset) => ({
              value: preset.id,
              label: preset.label ? label(preset.label) : preset.id,
              swatch: tintColor(preset.values) ?? null,
            }))}
            value={item.tint}
            onChange={(presetId) =>
              update((draft) => {
                const target = draft.outfit[slot];
                if (!target) return;
                target.tint =
                  presetId && outfit.tintPresets.some((preset) => preset.id === presetId)
                    ? presetId
                    : null;
                target.colors = {};
              })
            }
          />
        </Section>
      ) : null}

      {outfit && item
        ? colorParams.map((param, index) => (
            <Section key={param.name} title={paramLabel(param.name)}>
              {index === 0 ? <Hint>{t('colorsHint')}</Hint> : null}
              <SwatchPicker
                label={paramLabel(param.name)}
                size="sm"
                noneLabel={t('authored')}
                colors={GARMENT_COLORS.map((color) => ({
                  value: color.value,
                  label: colors(color.key),
                }))}
                value={item.colors[param.name] ?? null}
                onChange={(color) =>
                  update((draft) => {
                    const target = draft.outfit[slot];
                    if (!target) return;
                    if (color) target.colors[param.name] = color;
                    else delete target.colors[param.name];
                  })
                }
              />
            </Section>
          ))
        : null}
    </>
  );
}
