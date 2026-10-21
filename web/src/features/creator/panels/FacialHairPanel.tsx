'use client';

import { useTranslations } from 'next-intl';

import { groomsFor } from '../reconcile';
import { thumbnailSrc } from '../useMhManifest';
import { OptionGrid, OptionTile } from '../ui/OptionGrid';
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
              <OptionGrid label={t(slot)} columns="grid-cols-4">
                <OptionTile
                  label={t('none')}
                  none
                  selected={current === null}
                  onSelect={() => update((draft) => void (draft[slot].style = null))}
                />
                {options.map((groom) => (
                  <OptionTile
                    key={groom.id}
                    label={label(groom.label)}
                    image={thumbnailSrc(groom.thumbnail)}
                    selected={current === groom.id}
                    onSelect={() => update((draft) => void (draft[slot].style = groom.id))}
                  />
                ))}
              </OptionGrid>
            )}
          </Section>
        );
      })}
    </>
  );
}
