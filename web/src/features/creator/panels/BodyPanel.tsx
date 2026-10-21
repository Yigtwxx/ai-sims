'use client';

import { useTranslations } from 'next-intl';
import { memo, useCallback } from 'react';

import { Button } from '@/components/ui/button';
import { BODY_PRESETS, BODY_SLIDERS, type BodySlider } from '@/lib/character/schema';

import { bodyFor, presetSliders } from '../reconcile';
import { useCreatorStore } from '../store';
import { Hint, LabeledSlider, Section, Segmented } from '../ui/controls';

import { signedPercent, useConfig, type PanelProps } from './shared';

export function BodyPanel({ manifest }: PanelProps) {
  const t = useTranslations('Creator.body');
  const { config } = useConfig();
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
              return (
                <SliderRow
                  key={id}
                  id={id}
                  value={config.body.sliders[id] ?? def.default}
                  min={Math.max(-1, def.min)}
                  max={Math.min(1, def.max)}
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

/**
 * One body slider. Memoised: a drag re-renders the row being dragged, not all
 * seven (each a full Radix slider), which kept the editor busy for tens of
 * milliseconds per pointer move.
 */
const SliderRow = memo(function SliderRow({
  id,
  value,
  min,
  max,
}: {
  id: BodySlider;
  value: number;
  min: number;
  max: number;
}) {
  const t = useTranslations('Creator.body');
  const update = useCreatorStore((state) => state.update);
  const onChange = useCallback(
    (next: number) => update((draft) => void (draft.body.sliders[id] = Number(next.toFixed(3)))),
    [update, id],
  );
  return (
    <LabeledSlider
      label={t(`sliderNames.${id}`)}
      value={value}
      min={min}
      max={max}
      centered
      ends={[t(`ends.${id}.min`), t(`ends.${id}.max`)]}
      valueText={signedPercent(value, t('neutral'))}
      onChange={onChange}
    />
  );
});
