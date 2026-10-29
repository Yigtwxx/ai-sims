'use client';

import { PlusIcon, XIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

import { facesFor, MAX_FACE_BLENDS, skinsFor } from '../reconcile';
import { thumbnailSrc } from '../useMhManifest';
import { OptionGrid, OptionTile } from '../ui/OptionGrid';
import { Hint, LabeledSlider, Section } from '../ui/controls';

import { useConfig, useLabel, type PanelProps } from './shared';

export function FacePanel({ manifest }: PanelProps) {
  const t = useTranslations('Creator.face');
  const label = useLabel();
  const { config, update } = useConfig();
  const [picking, setPicking] = useState(false);
  // A blend reassembles the head: the stage gets the weight where a drag ends.
  const [dragging, setDragging] = useState<{ id: string; value: number } | null>(null);

  const faces = facesFor(manifest, config.base);
  const skinIds = new Set(skinsFor(manifest, config.base).map((skin) => skin.id));
  const byId = new Map(faces.map((face) => [face.id, face]));
  const blends = Object.entries(config.face.blend);
  const candidates = faces.filter(
    (face) => face.id !== config.face.preset && !(face.id in config.face.blend),
  );
  const full = blends.length >= MAX_FACE_BLENDS;

  return (
    <>
      <Section title={t('presets')} aside={faces.length}>
        <OptionGrid label={t('presets')}>
          {faces.map((face) => (
            <OptionTile
              key={face.id}
              label={label(face.label)}
              labelHidden
              image={thumbnailSrc(face.thumbnail)}
              selected={config.face.preset === face.id}
              onSelect={() =>
                update((draft) => {
                  draft.face.preset = face.id;
                  delete draft.face.blend[face.id];
                  if (skinIds.has(face.defaultSkin)) {
                    draft.skin.set = face.defaultSkin;
                  }
                })
              }
            />
          ))}
        </OptionGrid>
      </Section>

      <Section title={t('blend')} aside={`${blends.length}/${MAX_FACE_BLENDS}`}>
        <Hint>{t('blendHint')}</Hint>
        {blends.map(([id, committed]) => {
          const weight = dragging?.id === id ? dragging.value : committed;
          const face = byId.get(id);
          const name = face ? label(face.label) : id;
          const thumbnail = thumbnailSrc(face?.thumbnail);
          return (
            <div key={id} className="flex items-end gap-3">
              <div className="min-w-0 flex-1">
                <LabeledSlider
                  label={t('blendTowards', { name })}
                  lead={
                    thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element -- local manifest art, no optimizer needed
                      <img
                        src={thumbnail}
                        alt=""
                        draggable={false}
                        className="bg-paper-deep aspect-[3/4] w-9 rounded-md object-cover shadow-[0_0_0_1px_rgb(23_26_33/0.1)]"
                      />
                    ) : undefined
                  }
                  value={weight}
                  min={0}
                  max={1}
                  valueText={`${Math.round(weight * 100)}%`}
                  onChange={(value) => setDragging({ id, value })}
                  onCommit={(value) => {
                    setDragging(null);
                    update((draft) => void (draft.face.blend[id] = value));
                  }}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('removeBlend', { name })}
                onClick={() => update((draft) => void delete draft.face.blend[id])}
              >
                <XIcon aria-hidden="true" />
              </Button>
            </div>
          );
        })}

        {picking ? (
          <div className="rounded-tile border-hairline flex flex-col gap-3 border p-3">
            <p className="text-label text-ink-muted">{t('pickBlend')}</p>
            <OptionGrid label={t('pickBlend')} columns="grid-cols-4">
              {candidates.map((face) => (
                <OptionTile
                  key={face.id}
                  label={label(face.label)}
                  labelHidden
                  image={thumbnailSrc(face.thumbnail)}
                  selected={false}
                  onSelect={() => {
                    update((draft) => void (draft.face.blend[face.id] = 0.35));
                    setPicking(false);
                  }}
                />
              ))}
            </OptionGrid>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPicking(false)}>
              {t('cancelBlend')}
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="quiet"
            size="sm"
            disabled={full || candidates.length === 0}
            onClick={() => setPicking(true)}
            className="self-start"
          >
            <PlusIcon aria-hidden="true" />
            {t('addBlend')}
          </Button>
        )}
        {full ? <Hint>{t('blendFull')}</Hint> : null}
      </Section>
    </>
  );
}
