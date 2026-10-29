'use client';

import { useTranslations } from 'next-intl';

import { NUDE_TIGHTS_COLOR, SOCK_STYLES, type SockStyle } from '@/lib/character/schema';

import { restyleSocks, sockPalette } from '../socks';
import { ChipRadio, Hint, LabeledSlider, Section, SwatchPicker } from '../ui/controls';

import { useConfig } from './shared';

/** Sock length, colour and, for tights, sheerness; shown with the shoes. */
export function SocksSection() {
  const t = useTranslations('Creator.outfit.socks');
  const colors = useTranslations('Creator.colors');
  const { config, update } = useConfig();
  const { style, color, sheer } = config.socks;
  // Tights are made for the female body only (see reconcileConfig).
  const styles = SOCK_STYLES.filter((option) => option !== 'tights' || config.base === 'female');
  const sheerText = `${Math.round(sheer * 100)}%`;

  const chooseStyle = (next: SockStyle) =>
    update((draft) => void (draft.socks = restyleSocks(draft.socks, next)));

  return (
    <>
      <Section title={t('title')}>
        <ChipRadio
          label={t('lengthLabel')}
          value={style}
          options={styles.map((option) => ({ value: option, label: t(`lengths.${option}`) }))}
          onChange={chooseStyle}
        />
        <Hint>{t('hint')}</Hint>
      </Section>

      {style !== 'none' ? (
        <Section title={t(style === 'tights' ? 'tightsColor' : 'color')}>
          <SwatchPicker
            label={t(style === 'tights' ? 'tightsColor' : 'color')}
            size="sm"
            colors={sockPalette(style).map((option) => ({
              value: option.value,
              label: colors(option.key),
            }))}
            value={color}
            onChange={(next) => {
              if (next) update((draft) => void (draft.socks.color = next));
            }}
          />
          {style === 'tights' && color === NUDE_TIGHTS_COLOR ? <Hint>{t('nudeHint')}</Hint> : null}
        </Section>
      ) : null}

      {style === 'tights' ? (
        <Section title={t('sheer')} aside={sheerText}>
          <LabeledSlider
            label={t('sheer')}
            labelHidden
            value={sheer}
            min={0}
            max={1}
            ends={[t('opaque'), t('fine')]}
            valueText={sheerText}
            onChange={(value) =>
              update((draft) => void (draft.socks.sheer = Number(value.toFixed(2))))
            }
          />
        </Section>
      ) : null}
    </>
  );
}
