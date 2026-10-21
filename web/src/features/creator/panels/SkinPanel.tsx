'use client';

import { useTranslations } from 'next-intl';
import { useId } from 'react';

import { Switch } from '@/components/ui/switch';

import { skinsFor } from '../reconcile';
import { Hint, LabeledSlider, Section } from '../ui/controls';
import { SkinPicker } from '../ui/SkinPicker';

import { signedPercent, useConfig, useLabel, type PanelProps } from './shared';

export function SkinPanel({ manifest }: PanelProps) {
  const t = useTranslations('Creator.skin');
  const neutral = useTranslations('Creator.body')('neutral');
  const label = useLabel();
  const { config, update } = useConfig();
  const makeupId = useId();

  const skins = skinsFor(manifest, config.base);
  const current = manifest.skins.find((skin) => skin.id === config.skin.set);
  const hasMakeup = Boolean(current?.makeupAlbedo);

  return (
    <>
      <Section title={t('sets')} aside={current ? label(current.label) : undefined}>
        <SkinPicker
          label={t('sets')}
          bandLabels={{ light: t('bands.light'), medium: t('bands.medium'), deep: t('bands.deep') }}
          options={skins.map((skin) => ({
            id: skin.id,
            label: label(skin.label),
            swatch: skin.swatch,
            tone: skin.tone,
          }))}
          value={current?.id ?? null}
          onChange={(id) => update((draft) => void (draft.skin.set = id))}
        />
        <Hint>{t('setsHint')}</Hint>
      </Section>

      <Section title={t('tone')} aside={signedPercent(config.skin.tone, neutral)}>
        <LabeledSlider
          label={t('tone')}
          labelHidden
          value={config.skin.tone}
          min={-1}
          max={1}
          centered
          ends={[t('lighter'), t('darker')]}
          valueText={signedPercent(config.skin.tone, neutral)}
          onChange={(value) => update((draft) => void (draft.skin.tone = Number(value.toFixed(3))))}
        />
      </Section>

      <Section title={t('makeup')}>
        <div className="flex items-center justify-between gap-6">
          <label htmlFor={makeupId} className="text-body-sm text-ink-muted max-w-[34ch]">
            {hasMakeup ? t('makeupHint') : t('makeupUnavailable')}
          </label>
          <Switch
            id={makeupId}
            checked={hasMakeup && config.skin.makeup}
            disabled={!hasMakeup}
            onCheckedChange={(checked) => update((draft) => void (draft.skin.makeup = checked))}
          />
        </div>
      </Section>
    </>
  );
}
