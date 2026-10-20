/*
 * THESIS: The creator is a premiere wall. Options are poster art in catalog
 * rows beside a lit stage, not a settings form with sliders.
 * OWN-WORLD: Backstage graphite (#121113 and its raised layers), a single
 * marquee amber accent, 3:4 poster tiles, Big Shoulders display over
 * Schibsted Grotesk.
 * STORY: Name the star, sweep rows (face, body, hair, outfit), and watch the
 * camera follow each row. "Bitti" premieres the character, then the
 * conversation opens.
 * FIRST VIEWPORT: Left wall at 34vw: the name in display type, then rows that
 * scroll horizontally and dim when inactive, with Bitti pinned to the bottom.
 * The character fills the lit stage, its name set huge on the backdrop behind.
 * FORM: Streaming catalog wall, fused (challenger, chosen by the user on the
 * second roll; seed key dbbf45d3).
 */
'use client';

import { motion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';

import { useRouter } from '@/i18n/navigation';
import { BODY_BUILDS, HEIGHT_MAX, HEIGHT_MIN, NO_PART } from '@/lib/character/schema';
import { saveCharacterAction, saveThumbnailAction } from '@/lib/characters/saveActions';

import type { CameraFocus } from '../avatar/cameraFocus';
import {
  reconcileConfig,
  SKIN_TONES,
  skinToneHex,
  skinToneValue,
  toAvatarProps,
} from './avatarProps';
import {
  basesFor,
  partsFor,
  thumbnailUrl,
  type ManifestEntry,
  type PartCategory,
  type VrmManifest,
} from './manifest';
import { PremiereOverlay } from './PremiereOverlay';
import { StagePane } from './StagePane';
import { CLOTH_TINTS, EYE_TINTS, HAIR_TINTS, MAX_NAME_LENGTH, useCreatorStore } from './store';
import { ActionBar } from './ui/ActionBar';
import { HeightSlider } from './ui/HeightSlider';
import { NameField } from './ui/NameField';
import { PosterTile } from './ui/PosterTile';
import { Row } from './ui/Row';
import { Swatches } from './ui/Swatches';
import { useManifest } from './useManifest';

type RowId = 'gender' | 'face' | 'body' | 'skin' | 'eyes' | 'hair' | 'top' | 'bottom' | 'shoes';

const ROW_FOCUS: Record<RowId, CameraFocus> = {
  gender: 'body',
  face: 'face',
  body: 'body',
  skin: 'body',
  eyes: 'face',
  hair: 'face',
  top: 'torso',
  bottom: 'legs',
  shoes: 'feet',
};

type Phase = 'editing' | 'saving' | 'premiere';

interface CreatorScreenProps {
  /** Existing character to edit; omitted when creating. */
  initial?: { id: string; name: string; config: unknown };
}

export function CreatorScreen({ initial }: CreatorScreenProps) {
  const t = useTranslations('Creator');
  const locale = useLocale();
  const router = useRouter();
  const manifestState = useManifest();

  const name = useCreatorStore((s) => s.name);
  const config = useCreatorStore((s) => s.config);
  const { setName, update, setGender, randomize, load } = useCreatorStore.getState();
  const canUndo = useStore(useCreatorStore.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(useCreatorStore.temporal, (s) => s.futureStates.length > 0);

  const manifest = manifestState.status === 'ready' ? manifestState.manifest : undefined;
  const profiles = manifestState.status === 'ready' ? manifestState.profiles : undefined;

  // Reconcile defaults (or the edited character) with the parts actually offered.
  const loaded = useRef(false);
  useEffect(() => {
    if (!manifest || loaded.current) return;
    loaded.current = true;
    const state = useCreatorStore.getState();
    if (initial) load(initial.name, initial.config as typeof state.config, manifest);
    else useCreatorStore.setState({ config: reconcileConfig(state.config, manifest) });
    useCreatorStore.temporal.getState().clear();
  }, [manifest, initial, load]);

  const avatar = useMemo(
    () => (manifest ? toAvatarProps(config, manifest, profiles) : undefined),
    [config, manifest, profiles],
  );

  // Active row lifts immediately; the camera follows after a short settle so
  // sweeping the pointer across rows doesn't make it whip back and forth.
  const [activeRow, setActiveRow] = useState<RowId | undefined>();
  const [focus, setFocus] = useState<CameraFocus>('body');
  useEffect(() => {
    if (!activeRow) return;
    const timer = setTimeout(() => setFocus(ROW_FOCUS[activeRow]), 220);
    return () => clearTimeout(timer);
  }, [activeRow]);

  const panel = useRef<HTMLElement>(null);
  const [panelWidth, setPanelWidth] = useState(0);
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setPanelWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const [phase, setPhase] = useState<Phase>('editing');
  const [nameError, setNameError] = useState<string>();
  const [saveError, setSaveError] = useState<string>();
  const [savedId, setSavedId] = useState(initial?.id);
  const nameInput = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);

  const onDone = useCallback(async () => {
    if (!name.trim()) {
      setNameError(t('nameRequired'));
      nameInput.current?.focus();
      return;
    }
    setPhase('saving');
    setSaveError(undefined);
    const result = await saveCharacterAction({
      id: savedId,
      name: name.trim(),
      config,
      status: 'finalized',
    });
    if (!result.ok) {
      setPhase('editing');
      setSaveError(t('saveFailed'));
      return;
    }
    setSavedId(result.id);
    const snapshot = canvas.current ? captureThumbnail(canvas.current, panelWidth) : undefined;
    if (snapshot) void saveThumbnailAction(result.id, snapshot);
    setFocus('body');
    setPhase('premiere');
  }, [name, config, savedId, panelWidth, t]);

  // Keyboard: ⌘Z / ⇧⌘Z for history, R to randomize (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input, textarea, [contenteditable]');
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) useCreatorStore.temporal.getState().redo();
        else useCreatorStore.temporal.getState().undo();
      } else if (!typing && e.key.toLowerCase() === 'r' && manifest && phase === 'editing') {
        randomize(manifest);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [manifest, phase, randomize]);

  const premiere = phase === 'premiere';
  const rowProps = (id: RowId) => ({
    active: activeRow === id,
    dimmed: activeRow !== undefined && activeRow !== id,
    onActivate: () => setActiveRow(id),
  });

  return (
    <main className="bg-backstage relative h-dvh w-full overflow-hidden">
      <StagePane
        avatar={avatar}
        focus={premiere ? 'premiere' : focus}
        insetLeft={premiere ? 0 : panelWidth}
        showHint={!premiere}
        name={name}
        locale={locale}
        titleCard={premiere || !activeRow ? undefined : t(`rows.${activeRow}`)}
        labels={{ dragHint: t('dragHint'), loading: t('loadingStage') }}
        onCanvasReady={(el) => {
          canvas.current = el;
        }}
      />

      <motion.aside
        ref={panel}
        aria-label={t('title')}
        initial={{ x: -24, opacity: 0 }}
        animate={premiere ? { x: '-100%', opacity: 0 } : { x: 0, opacity: 1 }}
        transition={{ duration: premiere ? 0.8 : 0.6, ease: [0.16, 1, 0.3, 1] }}
        onPointerLeave={() => setActiveRow(undefined)}
        className="border-hairline bg-backstage absolute inset-y-0 left-0 z-20 flex w-[clamp(420px,34vw,560px)] flex-col border-r shadow-[24px_0_60px_rgba(0,0,0,0.35)]"
      >
        <NameField
          ref={nameInput}
          label={t('nameLabel')}
          placeholder={t('namePlaceholder')}
          value={name}
          maxLength={MAX_NAME_LENGTH}
          onChange={(value) => {
            setName(value);
            if (nameError && value.trim()) setNameError(undefined);
          }}
          error={nameError}
        />

        <div className="flex-1 scrollbar-none overflow-y-auto pb-6">
          {manifestState.status === 'error' ? (
            <div className="px-6 py-10" role="alert">
              <p className="text-ink text-[15px]">{t('manifestFailed')}</p>
              <button
                type="button"
                onClick={manifestState.retry}
                className="rounded-control bg-backstage-raised text-ink hover:bg-backstage-lift mt-4 h-10 px-4 text-[14px] font-medium"
              >
                {t('retry')}
              </button>
            </div>
          ) : !manifest ? (
            <RowsSkeleton />
          ) : (
            <Rows manifest={manifest} rowProps={rowProps} update={update} setGender={setGender} />
          )}
        </div>

        {saveError && (
          <p role="alert" className="text-alert px-6 pb-2 text-[13px]">
            {saveError}
          </p>
        )}
        <ActionBar
          labels={{
            undo: t('undo'),
            redo: t('redo'),
            randomize: t('randomize'),
            done: t('done'),
            saving: t('saving'),
          }}
          canUndo={canUndo}
          canRedo={canRedo}
          saving={phase === 'saving'}
          onUndo={() => useCreatorStore.temporal.getState().undo()}
          onRedo={() => useCreatorStore.temporal.getState().redo()}
          onRandomize={() => manifest && randomize(manifest)}
          onDone={onDone}
        />
      </motion.aside>

      {premiere && (
        <PremiereOverlay
          name={name.trim()}
          labels={{
            tagline: t('premiere.tagline'),
            start: t('premiere.start'),
            edit: t('premiere.edit'),
          }}
          onStart={() => router.push(savedId ? `/characters/${savedId}/chat` : '/characters')}
          onEdit={() => setPhase('editing')}
        />
      )}
    </main>
  );
}

interface RowsProps {
  manifest: VrmManifest;
  rowProps: (id: RowId) => { active: boolean; dimmed: boolean; onActivate: () => void };
  update: ReturnType<typeof useCreatorStore.getState>['update'];
  setGender: ReturnType<typeof useCreatorStore.getState>['setGender'];
}

/** All category rows of the wall, in the order a stylist would work. */
function Rows({ manifest, rowProps, update, setGender }: RowsProps) {
  const t = useTranslations('Creator');
  const config = useCreatorStore((s) => s.config);
  const gender = config.base;

  const defaultBase = (g: 'female' | 'male') => basesFor(manifest, g)[0];
  const faces = basesFor(manifest, gender);
  const tintNames = (palette: readonly string[]) =>
    palette.map((c, i) => (i === 0 ? t('original') : c));

  const partRow = (category: PartCategory, slot: 'top' | 'bottom' | 'shoes') => {
    const options = partsFor(manifest, category, gender);
    const current = config.outfit[slot];
    return (
      <Row
        key={slot}
        title={t(`rows.${slot}`)}
        meta={t('count', { count: options.length })}
        {...rowProps(slot)}
        tiles={
          <>
            <PosterTile
              label={t('none')}
              variant="empty"
              selected={current.id === NO_PART}
              onSelect={() => update((c) => void (c.outfit[slot].id = NO_PART))}
            />
            {options.map((part) => (
              <PartTile
                key={part.id}
                part={part}
                selected={current.id === part.id}
                onSelect={() => update((c) => void (c.outfit[slot].id = part.id))}
              />
            ))}
          </>
        }
      >
        <Swatches
          label={`${t(`rows.${slot}`)} · ${t('color')}`}
          colors={CLOTH_TINTS}
          names={tintNames(CLOTH_TINTS)}
          value={current.color ?? '#ffffff'}
          disabled={current.id === NO_PART}
          onChange={(color) => update((c) => void (c.outfit[slot].color = color))}
        />
      </Row>
    );
  };

  const hairOptions = partsFor(manifest, 'hair', gender);

  return (
    <motion.div
      initial="hidden"
      animate="shown"
      variants={{ shown: { transition: { staggerChildren: 0.045 } } }}
      className="flex flex-col"
    >
      {[
        <Row
          key="gender"
          title={t('rows.gender')}
          {...rowProps('gender')}
          tiles={(['female', 'male'] as const).map((g) => {
            const base = defaultBase(g);
            return (
              <PosterTile
                key={g}
                label={t(`bases.${g}`)}
                image={base ? thumbnailUrl(base.id) : undefined}
                selected={gender === g}
                onSelect={() => setGender(g, manifest)}
              />
            );
          })}
        />,
        <Row
          key="face"
          title={t('rows.face')}
          meta={t('count', { count: faces.length })}
          {...rowProps('face')}
          tiles={faces.map((face) => (
            <PartTile
              key={face.id}
              part={face}
              selected={config.face.preset === face.id}
              onSelect={() => update((c) => void (c.face.preset = face.id))}
            />
          ))}
        />,
        <Row
          key="body"
          title={t('rows.body')}
          meta={t(`builds.${config.body.build}`)}
          {...rowProps('body')}
          tiles={BODY_BUILDS.map((build) => (
            <PosterTile
              key={build}
              label={t(`builds.${build}`)}
              image={`/assets/vrm/thumbs/build-${gender}-${build}.webp`}
              selected={config.body.build === build}
              onSelect={() => update((c) => void (c.body.build = build))}
            />
          ))}
        >
          <HeightSlider
            label={t('height')}
            shortLabel={t('heightShort')}
            tallLabel={t('heightTall')}
            min={HEIGHT_MIN}
            max={HEIGHT_MAX}
            value={config.body.height}
            onChange={(height) => update((c) => void (c.body.height = height))}
          />
        </Row>,
        <Row key="skin" title={t('rows.skin')} {...rowProps('skin')}>
          <Swatches
            size="lg"
            label={t('rows.skin')}
            colors={SKIN_TONES}
            names={tintNames(SKIN_TONES)}
            value={skinToneHex(config.skin.tone)}
            onChange={(color) =>
              update(
                (c) =>
                  void (c.skin.tone = skinToneValue(
                    SKIN_TONES.indexOf(color as (typeof SKIN_TONES)[number]),
                  )),
              )
            }
          />
        </Row>,
        <Row key="eyes" title={t('rows.eyes')} {...rowProps('eyes')}>
          <Swatches
            size="lg"
            label={t('rows.eyes')}
            colors={EYE_TINTS}
            names={tintNames(EYE_TINTS)}
            value={config.eyes.color}
            onChange={(color) => update((c) => void (c.eyes.color = color))}
          />
        </Row>,
        <Row
          key="hair"
          title={t('rows.hair')}
          meta={t('count', { count: hairOptions.length })}
          {...rowProps('hair')}
          tiles={hairOptions.map((part) => (
            <PartTile
              key={part.id}
              part={part}
              selected={config.hair.style === part.id}
              onSelect={() => update((c) => void (c.hair.style = part.id))}
            />
          ))}
        >
          <Swatches
            label={`${t('rows.hair')} · ${t('color')}`}
            colors={HAIR_TINTS}
            names={tintNames(HAIR_TINTS)}
            value={config.hair.color}
            onChange={(color) => update((c) => void (c.hair.color = color))}
          />
        </Row>,
        partRow('top', 'top'),
        partRow('bottom', 'bottom'),
        partRow('shoes', 'shoes'),
      ].map((row, i) => (
        <motion.div
          key={i}
          variants={{
            hidden: { opacity: 0, y: 14 },
            shown: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
          }}
        >
          {row}
        </motion.div>
      ))}
    </motion.div>
  );
}

function PartTile({
  part,
  selected,
  onSelect,
}: {
  part: ManifestEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <PosterTile
      label={part.label}
      image={thumbnailUrl(part.id)}
      selected={selected}
      onSelect={onSelect}
    />
  );
}

function RowsSkeleton() {
  return (
    <div className="flex flex-col gap-7 px-6 pt-4" aria-hidden>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i}>
          <div className="bg-backstage-raised mb-3 h-3.5 w-20 animate-pulse rounded-full" />
          <div className="flex gap-3">
            {Array.from({ length: 3 }, (_, j) => (
              <div
                key={j}
                className="rounded-tile bg-backstage-raised aspect-[3/4] w-[7.25rem] animate-pulse"
                style={{ animationDelay: `${(i * 3 + j) * 60}ms` }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Crop a 3:4 WebP thumbnail of the visible stage (right of the panel). */
function captureThumbnail(canvas: HTMLCanvasElement, panelWidth: number): string | undefined {
  const scale = canvas.width / canvas.clientWidth;
  const visibleX = panelWidth * scale;
  const visibleW = canvas.width - visibleX;
  const cropH = canvas.height * 0.92;
  const cropW = Math.min(visibleW, cropH * 0.75);
  const out = document.createElement('canvas');
  out.width = 480;
  out.height = 640;
  const context = out.getContext('2d');
  if (!context) return undefined;
  context.drawImage(
    canvas,
    visibleX + (visibleW - cropW) / 2,
    canvas.height * 0.04,
    cropW,
    cropH,
    0,
    0,
    out.width,
    out.height,
  );
  const url = out.toDataURL('image/webp', 0.86);
  return url.startsWith('data:image/webp') ? url : undefined;
}
