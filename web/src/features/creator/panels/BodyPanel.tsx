'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { BODY_PRESETS, BODY_SLIDERS } from '@/lib/character/schema';

import { bodyFor, presetSliders } from '../reconcile';
import { useCreatorStore } from '../store';
import { Hint, LabeledSlider, Section, Segmented } from '../ui/controls';

import { signedPercent, useConfig, type PanelProps } from './shared';

export function BodyPanel({ manifest }: PanelProps) {
  const t = useTranslations('Creator.body');
  const { config, update } = useConfig();
  const setBodyPreset = useCreatorStore((state) => state.setBodyPreset);
  const body = bodyFor(manifest, config.base);
  const presets = BODY_PRESETS.filter((preset) => !body || preset in body.presets);

  const expected = presetSliders(manifest, config.base, config.body.preset);
  const custom = BODY_SLIDERS.some(
    (id) => Math.abs((config.body.sliders[id] ?? 0) - (expected[id] ?? 0)) > 0.005,
  );

  return (
    <>
      <Section title={t('presets')}>
        <Segmented
          label={t('presets')}
          value={config.body.preset}
          options={presets.map((preset) => ({ value: preset, label: t(`presetNames.${preset}`) }))}
          onChange={(preset) => setBodyPreset(preset, manifest)}
        />
        {custom ? (
          <div className="flex items-center justify-between gap-3">
            <Hint>{t('custom')}</Hint>
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => setBodyPreset(config.body.preset, manifest)}
            >
              {t('reset')}
            </Button>
          </div>
        ) : null}
      </Section>

      <Section title={t('sliders')}>
        {body ? (
          <div className="flex flex-col gap-5">
            {BODY_SLIDERS.map((id) => {
              const def = body.sliders.find((slider) => slider.id === id);
              if (!def) return null;
              const value = config.body.sliders[id] ?? def.default;
              return (
                <LabeledSlider
                  key={id}
                  label={t(`sliderNames.${id}`)}
                  value={value}
                  min={Math.max(-1, def.min)}
                  max={Math.min(1, def.max)}
                  centered
                  ends={[t(`ends.${id}.min`), t(`ends.${id}.max`)]}
                  valueText={signedPercent(value, t('neutral'))}
                  onChange={(next) =>
                    update((draft) => void (draft.body.sliders[id] = Number(next.toFixed(3))))
                  }
                />
              );
            })}
          </div>
        ) : (
          <Hint>{t('unavailable')}</Hint>
        )}
      </Section>
    </>
  );
}
