'use client';

import { useTranslations } from 'next-intl';

import { EYE_TINTS } from '../palettes';
import { facesFor } from '../reconcile';
import { Hint, Section, SwatchPicker } from '../ui/controls';

import { useConfig, useLabel, type PanelProps } from './shared';

export function EyesPanel({ manifest }: PanelProps) {
  const t = useTranslations('Creator.eyes');
  const colors = useTranslations('Creator.colors');
  const label = useLabel();
  const { config, update } = useConfig();

  const face = facesFor(manifest, config.base).find((item) => item.id === config.face.preset);
  const faceIris = manifest.irises.find((iris) => iris.id === face?.defaultIris);
  const swatchToId = new Map(manifest.irises.map((iris) => [iris.swatch.toLowerCase(), iris.id]));
  const current = manifest.irises.find((iris) => iris.id === config.eyes.iris);

  return (
    <>
      <Section title={t('iris')} aside={current ? label(current.label) : t('default')}>
        <SwatchPicker
          label={t('iris')}
          iris
          noneLabel={t('default')}
          colors={manifest.irises.map((iris) => ({ value: iris.swatch, label: label(iris.label) }))}
          value={current?.swatch ?? null}
          onChange={(swatch) => {
            const id = swatch ? (swatchToId.get(swatch.toLowerCase()) ?? null) : null;
            update((draft) => void (draft.eyes.iris = id));
          }}
        />
        {faceIris && !current ? (
          <p className="text-label text-ink-faint">{label(faceIris.label)}</p>
        ) : null}
      </Section>

      <Section title={t('tint')}>
        <SwatchPicker
          label={t('tint')}
          size="sm"
          noneLabel={t('noTint')}
          colors={EYE_TINTS.map((tint) => ({ value: tint.value, label: colors(tint.key) }))}
          value={config.eyes.color}
          onChange={(color) => update((draft) => void (draft.eyes.color = color))}
        />
        <Hint>{t('tintHint')}</Hint>
      </Section>
    </>
  );
}
