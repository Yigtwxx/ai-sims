/*
 * THESIS: The creator is a dressing room with the lights up: one dark panel
 * of decisions on the left, the character alone in the light on the right.
 * It refuses the settings-form look: choices are visual (faces, swatches,
 * grooms), labels are always readable, and every category moves the camera.
 * OWN-WORLD: The Lit Stage tokens; graphite panel, amber only for selection
 * and "Bitti", Mona Sans; display type for the name.
 * STORY: Name the character, walk the categories top to bottom (the camera
 * follows), undo freely, press "Bitti", watch the premiere, start talking.
 */
'use client';

import { ArrowLeftIcon } from '@phosphor-icons/react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { toast } from 'sonner';
import { useStore } from 'zustand';

import { StageBoundary, StageFailed } from '@/components/stage/StageBoundary';
import { StagePoster } from '@/components/stage/StagePoster';
import { Skeleton } from '@/components/ui/skeleton';
import type { CameraFocus } from '@/features/avatar/cameraFocus';
import { MhStage } from '@/features/avatar/mh/MhStage';
import { Link, useRouter } from '@/i18n/navigation';
import type { MhManifest, OutfitCategory } from '@/lib/assets/manifest';
import type { CharacterConfig } from '@/lib/character/schema';
import type { CharacterStatus } from '@/lib/characters/repository';
import { saveThumbnailAction } from '@/lib/characters/saveActions';
import { cn } from '@/lib/utils';

import { PremiereOverlay } from './PremiereOverlay';
import { BodyPanel } from './panels/BodyPanel';
import { EyesPanel } from './panels/EyesPanel';
import { FacePanel } from './panels/FacePanel';
import { FacialHairPanel } from './panels/FacialHairPanel';
import { HairPanel } from './panels/HairPanel';
import { IdentityPanel } from './panels/IdentityPanel';
import { JewelryPanel } from './panels/JewelryPanel';
import { OutfitPanel } from './panels/OutfitPanel';
import { SkinPanel } from './panels/SkinPanel';
import { TattooPanel } from './panels/TattooPanel';
import { MAX_NAME_LENGTH, useCreatorStore } from './store';
import { startingConfig } from './reconcile';
import { captureThumbnail } from './thumbnail';
import { ActionBar } from './ui/ActionBar';
import { NameField } from './ui/NameField';
import { useAutosave } from './useAutosave';
import { useMhManifest, wantsFixture, type ManifestState } from './useMhManifest';

export const CATEGORIES = [
  'identity',
  'face',
  'body',
  'skin',
  'eyes',
  'hair',
  'facialHair',
  'outfit',
  'jewelry',
  'tattoos',
] as const;
export type Category = (typeof CATEGORIES)[number];

const CATEGORY_FOCUS: Record<Exclude<Category, 'outfit'>, CameraFocus> = {
  identity: 'body',
  face: 'face',
  body: 'body',
  skin: 'face',
  eyes: 'face',
  hair: 'face',
  facialHair: 'face',
  jewelry: 'face',
  tattoos: 'torso',
};

const OUTFIT_FOCUS: Record<OutfitCategory, CameraFocus> = {
  top: 'torso',
  bottom: 'legs',
  shoes: 'feet',
  full: 'body',
};

type Phase = 'editing' | 'saving' | 'premiere';

export interface CreatorInitial {
  id: string;
  name: string;
  config: CharacterConfig;
  status: CharacterStatus;
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export function CreatorScreen({ initial }: { initial?: CreatorInitial }) {
  const t = useTranslations('Creator');
  const locale = useLocale();
  const router = useRouter();
  const reduceMotion = useReducedMotion() ?? false;
  const manifestState = useMhManifest();
  const manifest = manifestState.status === 'ready' ? manifestState.manifest : undefined;

  const name = useCreatorStore((state) => state.name);
  const canUndo = useStore(useCreatorStore.temporal, (state) => state.pastStates.length > 0);
  const canRedo = useStore(useCreatorStore.temporal, (state) => state.futureStates.length > 0);

  const [ready, setReady] = useState(false);
  const [category, setCategory] = useState<Category>('identity');
  const [outfitSlot, setOutfitSlot] = useState<OutfitCategory>('top');
  const [phase, setPhase] = useState<Phase>('editing');
  const [nameError, setNameError] = useState<string>();
  const [characterId, setCharacterId] = useState(initial?.id);
  const [status, setStatus] = useState<CharacterStatus>(initial?.status ?? 'draft');
  const [panelWidth, setPanelWidth] = useState(0);
  const [focusOverride, setFocusOverride] = useState<CameraFocus>();

  const panel = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  // Start editing once the parts are known: every id is reconciled with them.
  const loadedFor = useRef<MhManifest | null>(null);
  useEffect(() => {
    if (!manifest || loadedFor.current === manifest) return;
    loadedFor.current = manifest;
    const store = useCreatorStore.getState();
    store.load(
      initial?.name ?? '',
      initial?.config ?? startingConfig('female', manifest),
      manifest,
    );
    // A saved character starts clean; a new one waits for its first change.
    if (initial) useCreatorStore.getState().markSaved();
    else useCreatorStore.setState({ savedSnapshot: null });
    useCreatorStore.temporal.getState().clear();
    queueMicrotask(() => setReady(true));
  }, [manifest, initial]);

  useEffect(() => {
    const el = panel.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const wide = window.matchMedia('(min-width: 1024px)').matches;
      setPanelWidth(wide ? Math.round(entry.contentRect.width) : 0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const onCreated = useCallback(
    (id: string) => {
      setCharacterId(id);
      // Keep the URL reloadable without remounting the editor.
      window.history.replaceState(
        null,
        '',
        `/${locale}/characters/${id}/edit${window.location.search}`,
      );
    },
    [locale],
  );

  const autosave = useAutosave({
    enabled: ready && phase === 'editing',
    id: characterId,
    status,
    onCreated,
  });

  const focus: CameraFocus =
    phase === 'premiere'
      ? 'premiere'
      : (focusOverride ??
        (category === 'outfit' ? OUTFIT_FOCUS[outfitSlot] : CATEGORY_FOCUS[category]));

  const onDone = useCallback(async () => {
    if (!manifest) return;
    if (!useCreatorStore.getState().name.trim()) {
      setNameError(t('nameRequired'));
      nameInput.current?.focus();
      return;
    }
    // Panels go inert first, then a running autosave settles, so the
    // finalizing save reuses its id instead of creating a second character.
    setPhase('saving');
    await autosave.flush();
    const result = await autosave.save('finalized');
    if (!result.ok) {
      setPhase('editing');
      toast.error(t('saveFailed'));
      return;
    }
    setCharacterId(result.id);
    setStatus('finalized');

    // Frame a portrait, let the camera settle, then keep the card thumbnail.
    setFocusOverride('torso');
    await wait(reduceMotion ? 150 : 1100);
    const canvas = stage.current?.querySelector('canvas');
    const snapshot = canvas ? captureThumbnail(canvas, panelWidth) : undefined;
    if (snapshot) await saveThumbnailAction(result.id, snapshot).catch(() => false);
    setFocusOverride(undefined);
    setPhase('premiere');
  }, [manifest, autosave, panelWidth, reduceMotion, t]);

  // Keyboard: Ctrl/⌘+Z history and R randomize, never while typing in a field.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!manifest || phase !== 'editing' || isTyping(event.target)) return;
      const key = event.key.toLowerCase();
      const mod = event.metaKey || event.ctrlKey;
      if (mod && (key === 'z' || key === 'y')) {
        event.preventDefault();
        const temporal = useCreatorStore.temporal.getState();
        if (key === 'y' || event.shiftKey) temporal.redo();
        else temporal.undo();
      } else if (!mod && !event.altKey && key === 'r') {
        useCreatorStore.getState().randomize(manifest);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [manifest, phase]);

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta =
      event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowUp'
          ? -1
          : event.key === 'Home'
            ? -index
            : 0;
    const target = event.key === 'End' ? CATEGORIES.length - 1 : delta ? index + delta : undefined;
    if (target === undefined) return;
    event.preventDefault();
    const next = (target + CATEGORIES.length) % CATEGORIES.length;
    setCategory(CATEGORIES[next]);
    tabs.current[next]?.focus();
  };

  const premiere = phase === 'premiere';
  const editingDisabled = !ready || phase !== 'editing';

  return (
    <main className="bg-backstage relative h-dvh w-full overflow-hidden">
      <div ref={stage} className="absolute inset-0">
        {manifest && ready ? (
          <StageBoundary
            fallback={(retry) => (
              <StageFailed retry={retry} insetLeft={premiere ? 0 : panelWidth} />
            )}
          >
            <CreatorStage manifest={manifest} focus={focus} insetLeft={premiere ? 0 : panelWidth} />
          </StageBoundary>
        ) : (
          <div
            className="absolute inset-0 [--stage-floor:82%] [--stage-x:calc(50%+var(--panel,0px)/2)]"
            style={{ ['--panel' as string]: `${panelWidth}px` }}
          >
            <StagePoster />
          </div>
        )}
      </div>

      <StageOverlay
        left={premiere ? 0 : panelWidth}
        title={premiere ? undefined : t(`categories.${category}`)}
        hint={!premiere}
        fixture={manifestState.status === 'ready' && manifestState.fixture}
        labels={{ dragHint: t('dragHint'), fixture: t('manifest.fixtureBadge') }}
      />

      <motion.aside
        ref={panel}
        aria-label={t('title')}
        initial={reduceMotion ? false : { x: -24, opacity: 0 }}
        animate={premiere ? { x: '-100%', opacity: 0 } : { x: 0, opacity: 1 }}
        transition={{ duration: premiere ? 0.8 : 0.6, ease: [0.16, 1, 0.3, 1] }}
        // Inert while the finalizing save runs, so nothing is edited mid-save.
        inert={premiere || phase === 'saving'}
        className="border-hairline bg-backstage absolute inset-x-0 bottom-0 z-20 flex h-[64dvh] flex-col border-t shadow-[0_-18px_40px_rgb(5_5_4/0.45)] lg:inset-y-0 lg:right-auto lg:h-auto lg:w-[clamp(420px,34vw,560px)] lg:border-t-0 lg:border-r lg:shadow-[24px_0_60px_rgb(5_5_4/0.35)]"
      >
        <div className="flex items-center justify-between gap-3 px-6 pt-5">
          <Link
            href="/characters"
            className="rounded-tile text-label text-ink-muted hover:text-ink -ml-1 inline-flex items-center gap-1.5 px-1 transition-colors"
          >
            <ArrowLeftIcon className="size-4" aria-hidden="true" />
            {t('back')}
          </Link>
          <AutosaveNote status={autosave.status} />
        </div>

        <NameField
          ref={nameInput}
          label={t('nameLabel')}
          placeholder={t('namePlaceholder')}
          value={name}
          maxLength={MAX_NAME_LENGTH}
          disabled={!ready}
          onChange={(value) => {
            useCreatorStore.getState().setName(value);
            if (nameError && value.trim()) setNameError(undefined);
          }}
          error={nameError}
        />

        <div className="border-hairline flex min-h-0 flex-1 border-t">
          <div
            role="tablist"
            aria-label={t('categoriesLabel')}
            aria-orientation="vertical"
            className="border-hairline flex w-[8.5rem] shrink-0 scrollbar-none flex-col gap-0.5 overflow-y-auto border-r py-3"
          >
            {CATEGORIES.map((id, index) => {
              const active = id === category;
              return (
                <button
                  key={id}
                  ref={(node) => {
                    tabs.current[index] = node;
                  }}
                  type="button"
                  role="tab"
                  id={`creator-tab-${id}`}
                  aria-selected={active}
                  aria-controls="creator-panel"
                  tabIndex={active ? 0 : -1}
                  disabled={!ready}
                  onClick={() => setCategory(id)}
                  onKeyDown={(event) => onTabKey(event, index)}
                  className={cn(
                    'group text-ui relative flex min-h-10 items-center gap-2.5 px-4 py-2 text-left leading-tight transition-colors duration-200 disabled:opacity-40',
                    active ? 'text-ink' : 'text-ink-muted hover:text-ink',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'bg-marquee ease-out-expo h-px w-3 shrink-0 origin-left transition-transform duration-300',
                      active ? 'scale-x-100' : 'scale-x-0',
                    )}
                  />
                  {t(`categories.${id}`)}
                </button>
              );
            })}
          </div>

          <div
            role="tabpanel"
            id="creator-panel"
            aria-labelledby={`creator-tab-${category}`}
            tabIndex={0}
            className="min-w-0 flex-1 scrollbar-none overflow-y-auto px-5 pt-4 pb-8 outline-none"
          >
            {manifest && ready ? (
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={category}
                  initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
                  transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                  className="flex flex-col gap-1"
                >
                  <CategoryPanel
                    category={category}
                    manifest={manifest}
                    outfitSlot={outfitSlot}
                    onOutfitSlot={setOutfitSlot}
                  />
                </motion.div>
              </AnimatePresence>
            ) : (
              <ManifestPlaceholder state={manifestState} />
            )}
          </div>
        </div>

        <ActionBar
          labels={{
            undo: t('actions.undo'),
            redo: t('actions.redo'),
            randomize: t('actions.randomize'),
            done: t('actions.done'),
            saving: t('actions.saving'),
          }}
          canUndo={canUndo}
          canRedo={canRedo}
          saving={phase === 'saving'}
          disabled={editingDisabled}
          onUndo={() => useCreatorStore.temporal.getState().undo()}
          onRedo={() => useCreatorStore.temporal.getState().redo()}
          onRandomize={() => manifest && useCreatorStore.getState().randomize(manifest)}
          onDone={() => void onDone()}
        />
      </motion.aside>

      {premiere && characterId ? (
        <PremiereOverlay
          name={name.trim()}
          labels={{
            tagline: t('premiere.tagline'),
            start: t('premiere.start'),
            edit: t('premiere.edit'),
          }}
          onStart={() => router.push(`/characters/${characterId}/talk${fixtureQuery()}`)}
          onEdit={() => setPhase('editing')}
        />
      ) : null}
    </main>
  );
}

/** Keeps `?fixture=1` across creator → talk in development. */
function fixtureQuery() {
  return wantsFixture() ? '?fixture=1' : '';
}

function CategoryPanel({
  category,
  manifest,
  outfitSlot,
  onOutfitSlot,
}: {
  category: Category;
  manifest: MhManifest;
  outfitSlot: OutfitCategory;
  onOutfitSlot: (slot: OutfitCategory) => void;
}) {
  switch (category) {
    case 'identity':
      return <IdentityPanel manifest={manifest} />;
    case 'face':
      return <FacePanel manifest={manifest} />;
    case 'body':
      return <BodyPanel manifest={manifest} />;
    case 'skin':
      return <SkinPanel manifest={manifest} />;
    case 'eyes':
      return <EyesPanel manifest={manifest} />;
    case 'hair':
      return <HairPanel manifest={manifest} />;
    case 'facialHair':
      return <FacialHairPanel manifest={manifest} />;
    case 'outfit':
      return <OutfitPanel manifest={manifest} slot={outfitSlot} onSlotChange={onOutfitSlot} />;
    case 'jewelry':
      return <JewelryPanel />;
    case 'tattoos':
      return <TattooPanel />;
  }
}

/**
 * The stage, subscribed to the config on its own: an edit re-renders this and
 * the panel that made it, not the whole editor. The stage follows in the
 * background (deferred), so a slider drag never stalls on a stage render.
 */
function CreatorStage({
  manifest,
  focus,
  insetLeft,
}: {
  manifest: MhManifest;
  focus: CameraFocus;
  insetLeft: number;
}) {
  const config = useDeferredValue(useCreatorStore((state) => state.config));
  return (
    <MhStage
      config={config}
      manifest={manifest}
      mode="creator"
      focus={focus}
      insetLeft={insetLeft}
      className="size-full"
    />
  );
}

function AutosaveNote({ status }: { status: ReturnType<typeof useAutosave>['status'] }) {
  const t = useTranslations('Creator.autosave');
  if (status === 'idle') return null;
  const text = {
    needsName: t('needsName'),
    pending: t('pending'),
    saving: t('saving'),
    saved: t('saved'),
    error: t('error'),
  }[status];
  return (
    <p
      role="status"
      className={cn(
        'text-label max-w-[60%] truncate text-right',
        status === 'error'
          ? 'text-alert'
          : status === 'saved'
            ? 'text-ink-muted'
            : 'text-ink-faint',
      )}
    >
      {text}
    </p>
  );
}

function ManifestPlaceholder({ state }: { state: ManifestState }) {
  const t = useTranslations('Creator.manifest');
  if (state.status === 'loading' || state.status === 'ready') {
    return (
      <div role="status" aria-live="polite" className="flex flex-col gap-3">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-4 w-24 rounded-full" />
        <div className="grid grid-cols-3 gap-2.5">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="aspect-[3/4] w-full" />
          ))}
        </div>
      </div>
    );
  }
  if (state.status === 'missing') {
    return (
      <div className="flex flex-col items-start gap-4 pt-2">
        <p className="text-title text-ink">{t('missingTitle')}</p>
        <p className="text-body-sm text-ink-muted">{t('missingBody')}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={state.retry}
            className="rounded-control border-hairline bg-backstage-raised text-ui text-ink hover:bg-backstage-lift h-10 border px-4 transition-colors"
          >
            {t('retry')}
          </button>
          {state.fixtureAvailable ? (
            <a
              href="?fixture=1"
              className="rounded-control bg-marquee text-ui text-backstage hover:bg-marquee-deep inline-flex h-10 items-center px-4 font-semibold transition-colors"
            >
              {t('useFixture')}
            </a>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div role="alert" className="flex flex-col items-start gap-4 pt-2">
      <p className="text-title text-ink">{t('errorTitle')}</p>
      <button
        type="button"
        onClick={state.retry}
        className="rounded-control border-hairline bg-backstage-raised text-ui text-ink hover:bg-backstage-lift h-10 border px-4 transition-colors"
      >
        {t('retry')}
      </button>
    </div>
  );
}

/** Over the stage: the category as a quiet title card, the drag hint and the fixture badge. */
function StageOverlay({
  left,
  title,
  hint,
  fixture,
  labels,
}: {
  left: number;
  title?: string;
  hint: boolean;
  fixture: boolean;
  labels: { dragHint: string; fixture: string };
}) {
  const reduceMotion = useReducedMotion();
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 right-0 z-10 hidden lg:block"
      style={{ left }}
    >
      {fixture ? (
        <span className="border-marquee/40 text-label text-marquee absolute top-5 right-6 rounded-full border px-3 py-1">
          {labels.fixture}
        </span>
      ) : null}
      <AnimatePresence mode="wait">
        {title ? (
          <motion.p
            key={title}
            initial={reduceMotion ? false : { opacity: 0, y: 12, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="font-display text-headline text-ink/20 absolute bottom-8 left-10"
          >
            {title}
          </motion.p>
        ) : null}
      </AnimatePresence>
      {hint ? (
        <p className="border-hairline bg-backstage/70 text-label text-ink-muted absolute right-6 bottom-9 rounded-full border px-4 py-1.5">
          {labels.dragHint}
        </p>
      ) : null}
    </div>
  );
}
