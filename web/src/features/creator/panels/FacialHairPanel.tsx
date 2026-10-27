'use client';

import { useTranslations } from 'next-intl';

import { groomsFor } from '../reconcile';
import { thumbnailSrc } from '../useMhManifest';
import { OptionList } from '../ui/OptionList';
import { Hint, Section } from '../ui/controls';

import { useConfig, useLabel, type PanelProps } from './shared';

const SLOTS = ['eyebrows', 'beard', 'mustache'] as const;

export function FacialHairPanel({ manifest }: PanelProps) {
  const t = useTranslations('Creator.facialHair');
  const label = useLabel();
  const { config, update } = useConfig();

  return (
    <>
      <Hint>{t('sharedColor')}</Hint>
      {SLOTS.map((slot) => {
        const options = groomsFor(manifest, slot, config.base);
        const current = config[slot].style;
        return (
          <Section key={slot} title={t(slot)} aside={options.length || undefined}>
            {options.length === 0 ? (
              <Hint>{t('unavailable')}</Hint>
            ) : (
              <OptionList
                label={t(slot)}
                items={[
                  { value: null, label: t('none') },
                  ...options.map((groom) => ({
                    value: groom.id,
                    label: label(groom.label),
                    image: thumbnailSrc(groom.thumbnail),
                  })),
                ]}
                value={current}
                onChange={(style) => update((draft) => void (draft[slot].style = style))}
              />
            )}
          </Section>
        );
      })}
    </>
  );
}
