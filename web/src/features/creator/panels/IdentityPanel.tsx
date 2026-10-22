'use client';

import { useTranslations } from 'next-intl';

import { useCreatorStore } from '../store';
import { thumbnailSrc } from '../useMhManifest';
import { OptionGrid, OptionTile } from '../ui/OptionGrid';
import { Hint, Section, Segmented } from '../ui/controls';
import { startingFace } from '../reconcile';

import { useConfig, type PanelProps } from './shared';

/** Female first: the default base. */
const BASES = ['female', 'male'] as const;

export function IdentityPanel({ manifest }: PanelProps) {
  const t = useTranslations('Creator.identity');
  const { config, update } = useConfig();
  const setBase = useCreatorStore((state) => state.setBase);

  return (
    <>
      <Section title={t('base')}>
        <OptionGrid label={t('base')} columns="grid-cols-2">
          {BASES.map((base) => (
            <OptionTile
              key={base}
              label={t(`bases.${base}`)}
              image={thumbnailSrc(startingFace(manifest, base)?.thumbnail)}
              selected={config.base === base}
              onSelect={() => setBase(base, manifest)}
            />
          ))}
        </OptionGrid>
        <Hint>{t('baseHint')}</Hint>
      </Section>

      <Section title={t('voice')}>
        <Segmented
          label={t('voice')}
          value={config.voice.gender}
          options={BASES.map((gender) => ({ value: gender, label: t(`voices.${gender}`) }))}
          onChange={(gender) => update((draft) => void (draft.voice.gender = gender))}
        />
        <Hint>{t('voiceHint')}</Hint>
      </Section>
    </>
  );
}
