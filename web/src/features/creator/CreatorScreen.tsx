/*
 * THESIS: The creator is a control room: one paper panel of decisions on the
 * left (a category rail beside the controls), the character in a lit studio
 * on the right, framed like a camera viewfinder. It refuses the settings-form
 * look: choices are visual (faces, swatches, grooms), labels are always
 * readable, and every category moves the camera.
 * OWN-WORLD: Paper and Ink tokens; ink for text and the picked option, mono
 * kickers for labels and readouts, cobalt only for focus, ticks, the slider
 * handle and the active rail mark; Geologica for the name.
 * STORY: Name the character, walk the categories top to bottom (the camera
 * follows, or pick a framing over the stage), undo freely, press "Bitti",
 * watch the premiere, start talking.
 */
'use client';

import {
  ArrowLeftIcon,
  DiamondIcon,
  DropHalfIcon,
  EyeIcon,
  IdentificationCardIcon,
  PenNibIcon,
  PersonIcon,
  ScanSmileyIcon,
  ScissorsIcon,
  TShirtIcon,
} from '@phosphor-icons/react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter as useNextRouter } from 'next/navigation';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
} from 'react';
import { toast } from 'sonner';
import { useStore } from 'zustand';

import { EASE, SPRING_SOFT } from '@/components/motion/tokens';
import { StageLoading } from '@/components/shell/StageLoading';
import { StageBoundary, StageFailed } from '@/components/stage/StageBoundary';
import { StagePoster } from '@/components/stage/StagePoster';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { CameraFocus } from '@/features/avatar/cameraFocus';
import type { QualityPreference } from '@/features/avatar/quality';
import { MhStage } from '@/features/avatar/mh/MhStage';
import { Link, useRouter } from '@/i18n/navigation';
import type { MhManifest, OutfitCategory } from '@/lib/assets/manifest';
import type { CharacterConfig } from '@/lib/character/schema';
import type { CharacterStatus } from '@/lib/characters/repository';
import { saveThumbnailAction } from '@/lib/characters/saveActions';
import { cn } from '@/lib/utils';

import { CAMERA_PRESETS, resolveFocus, type CameraPreset } from './framing';
import { TATTOO_FOCUS, type TattooPlacement } from './tattoos';
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
import { MAX_NAME_LENGTH, snapshotOf, useCreatorStore } from './store';
import { startingConfig } from './reconcile';
import { clearLocalDraft, mayRestoreLocalDraft, readLocalDraft } from './localDraft';
import { useQualityPreference } from './qualityPreference';
import { captureThumbnail, portraitCrop } from './thumbnail';
import { ActionBar } from './ui/ActionBar';
import { SlidingIndicator } from './ui/controls';
import { MustacheIcon } from './ui/MustacheIcon';
import { NameField } from './ui/NameField';
import { StageChrome } from './ui/StageChrome';
import { useAutosave } from './useAutosave';
import { useLocalDraft } from './useLocalDraft';
import { useMhManifest, wantsFixture, type ManifestState } from './useMhManifest';
import { createWaitFlag } from './waitFlag';

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
  face: 'head',
  body: 'body',
  skin: 'head',
  eyes: 'head',
  hair: 'head',
  facialHair: 'head',
  jewelry: 'torso',
  tattoos: 'upper',
};

const OUTFIT_FOCUS: Record<OutfitCategory, CameraFocus> = {
  top: 'upper',
  bottom: 'legs',
  shoes: 'feet',
  full: 'body',
};

/** Rail glyphs: Phosphor at its regular weight (and one drawn to match it). */
const CATEGORY_ICONS: Record<
  Category,
  ComponentType<{ className?: string; 'aria-hidden'?: 'true' }>
> = {
  identity: IdentificationCardIcon,
  face: ScanSmileyIcon,
  body: PersonIcon,
  skin: DropHalfIcon,
  eyes: EyeIcon,
  hair: ScissorsIcon,
  facialHair: MustacheIcon,
  outfit: TShirtIcon,
  jewelry: DiamondIcon,
  tattoos: PenNibIcon,
};

type Phase = 'editing' | 'saving' | 'premiere';
/** The beats of "Bitti" while the phase is 'saving' (the stage chrome reads them out). */
type DoneStep = 'saving' | 'framing' | 'captured';

/** The card portrait taken on "Bitti", and where it sat on the stage (CSS pixels). */
interface Capture {
  src: string;
  rect: { left: number; top: number; width: number; height: number };
}

/** The taken portrait travels from the stage into the premiere card (shared layout). */
const PORTRAIT_LAYOUT_ID = 'creator-premiere-portrait';

/** Desktop premiere: the character stands at 60% of the width, like the landing's last frame. */
const PREMIERE_INSET = 0.2;

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

/** The "draft restored" notice, dismissed once the server holds the character. */
const LOCAL_DRAFT_TOAST = 'creator-local-draft';

/** At most this long for a face picked just before "Bitti" to reach the stage. */
const STAGE_CATCH_UP_MS = 8000;

/**
 * Next keeps visited pages alive (Activity), so a new visit to a kept editor
 * would reopen it as it was left: mid-premiere, on the last category, with the
 * old draft in the store. Each new visit (a push; back and forward keep
 * bfcacheId) mounts a fresh editor that loads the character from `initial`.
 */
export function CreatorScreen({ initial }: { initial?: CreatorInitial }) {
  const { bfcacheId } = useNextRouter();
  return <CreatorEditor key={bfcacheId} visit={bfcacheId} initial={initial} />;
}

function CreatorEditor({ initial, visit }: { initial?: CreatorInitial; visit: string }) {
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
  // The placement picked on the tattoo panel: framed, and shown through clothes.
  const [tattooPlacement, setTattooPlacement] = useState<TattooPlacement>('innerWrist');
  // A framing picked over the stage; the next category (or garment slot) frames itself again.
  const [preset, setPreset] = useState<CameraPreset | null>(null);
  const [quality, setQuality] = useQualityPreference();
  const [phase, setPhase] = useState<Phase>('editing');
  const [nameError, setNameError] = useState<string>();
  const [characterId, setCharacterId] = useState(initial?.id);
  const [status, setStatus] = useState<CharacterStatus>(initial?.status ?? 'draft');
  const [panelWidth, setPanelWidth] = useState(0);
  const [stageWidth, setStageWidth] = useState(0);
  const [focusOverride, setFocusOverride] = useState<CameraFocus>();
  const [doneStep, setDoneStep] = useState<DoneStep>('saving');
  const [capture, setCapture] = useState<Capture>();
  // Something is on the stage: the character, dressed and drawn, or the failure note.
  const [stageShown, setStageShown] = useState(false);
  const markStageShown = useCallback(() => setStageShown(true), []);
  // Whether the stage shows the character the config asks for, dressed and
  // drawn: a new face assembles off screen while the old one stays on.
  const stageCaughtUp = useRef(createWaitFlag());
  // The same, for the busy slate: a swap or reload is pending behind the
  // character on screen (a new face, skin, hair or clothes still loading).
  const [stageBusy, setStageBusy] = useState(false);
  const onStageCaughtUp = useCallback((caughtUp: boolean) => {
    stageCaughtUp.current.set(caughtUp);
    setStageBusy(!caughtUp);
  }, []);
  // A failed stage has nothing to catch up with; "Bitti" must not wait for it.
  const markStageFailed = useCallback(() => {
    setStageShown(true);
    setStageBusy(false);
    stageCaughtUp.current.set(true);
  }, []);
  // A retry mounts the stage afresh: the loading caption returns until it settles.
  const retryStage = (retry: () => void) => {
    setStageShown(false);
    setStageBusy(false);
    retry();
  };

  const panel = useRef<HTMLElement>(null);
  const panelBody = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  // Start editing once the parts are known: every id is reconciled with them.
  // A new character reloaded before it had a server copy comes back from the
  // tab's local draft; any other new visit starts over and drops that draft.
  const loadedFor = useRef<MhManifest | null>(null);
  useEffect(() => {
    if (!manifest || loadedFor.current === manifest) return;
    loadedFor.current = manifest;
    const draft = !initial && mayRestoreLocalDraft(visit) ? readLocalDraft() : null;
    if (!initial && !draft) clearLocalDraft();
    const fresh = startingConfig('female', manifest);
    const store = useCreatorStore.getState();
    store.load(
      initial?.name ?? draft?.name ?? '',
      initial?.config ?? draft?.config ?? fresh,
      manifest,
    );
    // A saved character starts clean; a new one waits for its first change.
    if (initial) useCreatorStore.getState().markSaved();
    else useCreatorStore.setState({ savedSnapshot: null });
    useCreatorStore.temporal.getState().clear();
    queueMicrotask(() => setReady(true));
    // Say so only when the draft holds work (not an untouched start).
    const loaded = useCreatorStore.getState();
    if (draft && snapshotOf(loaded.name, loaded.config) !== snapshotOf('', fresh)) {
      toast(t('localDraft.restored'), {
        id: LOCAL_DRAFT_TOAST,
        // Long enough to read and change one's mind while the stage still loads.
        duration: 8000,
        action: {
          label: t('localDraft.startOver'),
          onClick: () => {
            clearLocalDraft();
            useCreatorStore.getState().load('', fresh, manifest);
            useCreatorStore.setState({ savedSnapshot: null });
            useCreatorStore.temporal.getState().clear();
          },
        },
      });
    }
  }, [manifest, initial, visit, t]);

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

  useEffect(() => {
    const el = stage.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(([entry]) =>
      setStageWidth(Math.round(entry.contentRect.width)),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const onCreated = useCallback(
    (id: string) => {
      setCharacterId(id);
      // The server copy takes over from the tab's draft (and its "start over").
      clearLocalDraft();
      toast.dismiss(LOCAL_DRAFT_TOAST);
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
  // Until the first server save, the tab keeps the work (a nameless draft is
  // not autosaved, and a reload would otherwise lose it).
  useLocalDraft(!initial && !characterId && ready && phase === 'editing');

  const categoryFocus =
    category === 'outfit'
      ? OUTFIT_FOCUS[outfitSlot]
      : category === 'tattoos'
        ? TATTOO_FOCUS[tattooPlacement]
        : CATEGORY_FOCUS[category];
  const focus: CameraFocus =
    phase === 'premiere' ? 'premiere' : resolveFocus(focusOverride ?? null, preset, categoryFocus);
  // The framing button that reads as pressed: the user's pick, or the
  // category's own framing when it is one of the presets.
  const framing = resolveFocus(null, preset, categoryFocus);
  const pressedPreset = CAMERA_PRESETS.find((option) => option === framing) ?? null;
  const chooseCategory = useCallback((next: Category) => {
    setCategory(next);
    setPreset(null);
  }, []);
  const chooseOutfitSlot = useCallback((slot: OutfitCategory) => {
    setOutfitSlot(slot);
    setPreset(null);
  }, []);
  const chooseTattooPlacement = useCallback((placement: TattooPlacement) => {
    setTattooPlacement(placement);
    setPreset(null);
  }, []);

  const onDone = useCallback(async () => {
    if (!manifest) return;
    if (!useCreatorStore.getState().name.trim()) {
      setNameError(t('nameRequired'));
      nameInput.current?.focus();
      return;
    }
    // Panels go inert first, then a running autosave settles, so the
    // finalizing save reuses its id instead of creating a second character.
    setDoneStep('saving');
    setCapture(undefined);
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

    // Frame a portrait (the viewfinder closes in on the crop as the camera
    // moves). A face picked just now may still be assembling off screen behind
    // the old one: wait for it, let the camera settle (it frames the new
    // height too), then keep the card thumbnail.
    setDoneStep('framing');
    setFocusOverride('torso');
    await stageCaughtUp.current.wait(STAGE_CATCH_UP_MS);
    await wait(reduceMotion ? 150 : 1100);
    const canvas = stage.current?.querySelector('canvas');
    const snapshot = canvas ? captureThumbnail(canvas, panelWidth) : undefined;
    // The shot: the still holds the frame under the flash, then becomes the card.
    if (snapshot && stage.current) {
      const crop = portraitCrop(stage.current.clientWidth, stage.current.clientHeight, panelWidth);
      setCapture({
        src: snapshot,
        rect: { left: crop.x, top: crop.y, width: crop.width, height: crop.height },
      });
    }
    setDoneStep('captured');
    await Promise.all([
      snapshot ? saveThumbnailAction(result.id, snapshot).catch(() => false) : undefined,
      wait(reduceMotion ? 0 : 380),
    ]);
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

  // On the narrow strip, keep the active category in view (centred) when it changes.
  useEffect(() => {
    const tab = tabs.current[CATEGORIES.indexOf(category)];
    const strip = tab?.parentElement;
    if (!tab || !strip || strip.scrollWidth <= strip.clientWidth) return;
    const offset = tab.getBoundingClientRect().left - strip.getBoundingClientRect().left;
    strip.scrollTo({
      left: strip.scrollLeft + offset - (strip.clientWidth - tab.offsetWidth) / 2,
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
  }, [category, reduceMotion]);

  // The rail is vertical beside the panel on desktop and a horizontal strip
  // on narrow screens; both arrow pairs move between the tabs.
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? -1
          : event.key === 'Home'
            ? -index
            : 0;
    const target = event.key === 'End' ? CATEGORIES.length - 1 : delta ? index + delta : undefined;
    if (target === undefined) return;
    event.preventDefault();
    const next = (target + CATEGORIES.length) % CATEGORIES.length;
    chooseCategory(CATEGORIES[next]);
    tabs.current[next]?.focus();
  };

  const premiere = phase === 'premiere';
  const editingDisabled = !ready || phase !== 'editing';
  // The premiere frees the whole stage; on desktop the character steps right,
  // leaving the lower left for the title card.
  const stageInset = premiere
    ? panelWidth > 0
      ? Math.round(stageWidth * PREMIERE_INSET)
      : 0
    : panelWidth;

  return (
    <main className="bg-paper relative h-dvh w-full overflow-hidden [--creator-panel:64dvh]">
      {/* On narrow screens the stage ends where the panel starts: the camera frames the
          uncovered strip, not a full-height canvas half hidden behind the panel. For the
          premiere it takes the upper part of the screen and the title card sits below. */}
      <div
        ref={stage}
        className={cn(
          'absolute inset-0',
          premiere ? 'max-lg:bottom-[38%]' : 'bottom-(--creator-panel) lg:bottom-0',
        )}
      >
        {manifest && ready ? (
          <StageBoundary
            fallback={(retry) => (
              <>
                <StageFailed retry={() => retryStage(retry)} insetLeft={stageInset} />
                <OnMount run={markStageFailed} />
              </>
            )}
          >
            <CreatorStage
              manifest={manifest}
              focus={focus}
              revealTattoo={category === 'tattoos' ? tattooPlacement : null}
              insetLeft={stageInset}
              quality={quality}
              onSettled={markStageShown}
              onCaughtUp={onStageCaughtUp}
            />
          </StageBoundary>
        ) : (
          <div
            // Before the panel is measured, assume its CSS width on desktop so the
            // spotlight does not jump sideways once it is.
            className="absolute inset-0 [--stage-floor:82%] [--stage-x:calc(50%+var(--panel,0px)/2)] lg:[--panel:clamp(440px,32vw,500px)]"
            style={panelWidth ? { ['--panel' as string]: `${panelWidth}px` } : undefined}
          >
            <StagePoster />
          </div>
        )}
      </div>

      {/* The portrait just taken, holding its place on the stage under the flash
          until the premiere carries it into the title card. */}
      {capture && phase === 'saving' && doneStep === 'captured' ? (
        <motion.img
          layoutId={reduceMotion ? undefined : PORTRAIT_LAYOUT_ID}
          src={capture.src}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute z-[9] object-cover"
          style={capture.rect}
        />
      ) : null}

      <StageChrome
        left={panelWidth}
        mode={phase === 'editing' ? 'editing' : phase === 'premiere' ? 'premiere' : doneStep}
        preset={pressedPreset}
        onPreset={setPreset}
        quality={quality}
        onQuality={setQuality}
        fixture={manifestState.status === 'ready' && manifestState.fixture}
        focusKey={focus}
      />

      {/* Lower corner of the uncovered stage (left on phones, right of the gesture
          hint's corner on desktop): first while the character comes on, then
          whenever an edit is still loading behind the one on screen. */}
      <StageLoading
        show={
          stageShown
            ? stageBusy && phase === 'editing'
            : manifestState.status === 'loading' || manifestState.status === 'ready'
        }
        label={stageShown ? t('updatingCharacter') : t('loadingCharacter')}
        className="absolute bottom-[calc(var(--creator-panel)+0.75rem)] left-4 z-10 max-w-[calc(100%-2rem)] lg:right-4 lg:bottom-4 lg:left-auto lg:max-w-[40%]"
      />

      <motion.aside
        ref={panel}
        aria-label={t('title')}
        // The entrance is CSS (animate-panel-in), so the panel is visible from the
        // first paint instead of waiting for hydration; Motion owns the exit.
        initial={false}
        animate={premiere ? { x: '-100%', opacity: 0 } : { x: 0, opacity: 1 }}
        transition={{ duration: premiere ? 0.8 : 0.6, ease: [0.16, 1, 0.3, 1] }}
        // Inert while the finalizing save runs, so nothing is edited mid-save.
        inert={premiere || phase === 'saving'}
        className="border-hairline bg-paper-raised animate-panel-in absolute inset-x-0 bottom-0 z-20 flex h-(--creator-panel) flex-col border-t shadow-[0_-10px_30px_rgb(23_26_33/0.07)] lg:inset-y-0 lg:right-auto lg:h-auto lg:w-[clamp(440px,32vw,500px)] lg:border-t-0 lg:border-r lg:shadow-none"
      >
        {/* Head of the panel: the way back and the save state on one line, then the name. */}
        <div className="border-hairline border-b px-4 pt-2 pb-2.5 lg:px-5 lg:pt-3.5 lg:pb-4">
          <div className="flex min-h-8 items-center justify-between gap-4">
            <Link
              href="/characters"
              className="group/back text-ink-muted hover:text-ink hover:bg-ink/[0.05] -ml-1.5 inline-flex h-8 shrink-0 items-center gap-2 rounded-full pr-2.5 pl-1.5 font-mono text-[11px] tracking-[0.1em] uppercase transition-[background-color,color] duration-200"
            >
              <ArrowLeftIcon
                className="ease-out-expo size-3.5 transition-transform duration-300 group-hover/back:-translate-x-0.5"
                aria-hidden="true"
              />
              {t('back')}
            </Link>
            <AutosaveNote status={autosave.status} />
          </div>

          <NameField
            ref={nameInput}
            className="mt-1.5 lg:mt-4"
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
            // The long form of the short "in this tab" status above.
            note={autosave.status === 'needsName' ? t('autosave.needsName') : undefined}
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div
            role="tablist"
            aria-label={t('categoriesLabel')}
            aria-orientation={panelWidth > 0 ? 'vertical' : 'horizontal'}
            className="border-hairline scroll-fade-x lg:scroll-fade-y flex shrink-0 scrollbar-none gap-1 overflow-x-auto border-b px-3 py-2 [--fade-end:2rem] [--fade-start:0.75rem] lg:w-[72px] lg:flex-col lg:gap-0 lg:overflow-x-hidden lg:overflow-y-auto lg:border-r lg:border-b-0 lg:px-0 lg:py-1 lg:[--fade-end:1rem] lg:[--fade-start:0.25rem]"
          >
            {CATEGORIES.map((id, index) => {
              const active = id === category;
              const Icon = CATEGORY_ICONS[id];
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
                  onClick={() => chooseCategory(id)}
                  onKeyDown={(event) => onTabKey(event, index)}
                  className={cn(
                    'group relative flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 transition-[color,background-color,scale] duration-200 focus-visible:-outline-offset-2 active:scale-[0.97] active:duration-100 disabled:opacity-40',
                    'lg:h-auto lg:min-h-[3.75rem] lg:w-full lg:flex-col lg:justify-center lg:gap-1.5 lg:rounded-none lg:px-1 lg:py-2.5',
                    active
                      ? 'text-cobalt'
                      : 'text-ink-muted hover:text-ink lg:hover:bg-paper-lift/50',
                  )}
                >
                  {/* The fill and the cobalt mark glide to the picked category (shared layout). */}
                  {active ? (
                    <>
                      <SlidingIndicator layoutId="creator-category" className={TAB_FILL} />
                      <SlidingIndicator layoutId="creator-category-mark" className={TAB_MARK} />
                    </>
                  ) : null}
                  <Icon className="relative size-4 shrink-0 lg:size-5" aria-hidden="true" />
                  <span className="relative font-mono text-[11px] leading-[1.15] tracking-[0.08em] whitespace-nowrap uppercase lg:text-center lg:text-[9.5px] lg:tracking-[0.06em] lg:whitespace-normal">
                    {t(`categories.${id}`)}
                  </span>
                </button>
              );
            })}
          </div>

          <div
            ref={panelBody}
            role="tabpanel"
            id="creator-panel"
            aria-labelledby={`creator-tab-${category}`}
            tabIndex={0}
            className="scroll-fade-y min-w-0 flex-1 scrollbar-none overflow-y-auto px-4 pt-4 pb-12 outline-none [--fade-end:3rem] [--fade-start:0.5rem] lg:px-[18px] lg:pt-5"
          >
            {manifest && ready ? (
              // The old category leaves fast (opacity only); the panel scrolls back
              // to the top unseen; the new one slides in from the rail on a soft
              // spring while its options stagger in (CSS). Reduced motion keeps
              // only the fades.
              <AnimatePresence
                mode="wait"
                initial={false}
                onExitComplete={() => panelBody.current?.scrollTo({ top: 0 })}
              >
                <motion.div
                  key={category}
                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -10 }}
                  animate={{
                    opacity: 1,
                    x: 0,
                    transition: {
                      ...SPRING_SOFT,
                      opacity: { duration: 0.18, ease: EASE.outQuint },
                    },
                  }}
                  exit={{ opacity: 0, transition: { duration: 0.1, ease: EASE.inQuart } }}
                  className="flex flex-col gap-1"
                >
                  <CategoryPanel
                    category={category}
                    manifest={manifest}
                    outfitSlot={outfitSlot}
                    onOutfitSlot={chooseOutfitSlot}
                    tattooPlacement={tattooPlacement}
                    onTattooPlacement={chooseTattooPlacement}
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

      <AnimatePresence>
        {premiere && characterId && manifest ? (
          <PremiereOverlay
            key="premiere"
            name={name.trim()}
            manifest={manifest}
            portrait={capture?.src}
            portraitLayoutId={reduceMotion ? undefined : PORTRAIT_LAYOUT_ID}
            onStart={() => router.push(`/characters/${characterId}/talk${fixtureQuery()}`)}
            onEdit={() => setPhase('editing')}
          />
        ) : null}
      </AnimatePresence>
    </main>
  );
}

/**
 * The active category: a lifted fill (a pill on the phone strip, the full row
 * on the rail) and, on the rail, a 2px cobalt mark on its leading edge.
 */
const TAB_FILL = 'bg-paper-lift inset-0 rounded-full lg:rounded-none';
const TAB_MARK = 'bg-cobalt inset-y-0 left-0 hidden w-0.5 lg:block';

/** Keeps `?fixture=1` across creator → talk in development. */
function fixtureQuery() {
  return wantsFixture() ? '?fixture=1' : '';
}

function CategoryPanel({
  category,
  manifest,
  outfitSlot,
  onOutfitSlot,
  tattooPlacement,
  onTattooPlacement,
}: {
  category: Category;
  manifest: MhManifest;
  outfitSlot: OutfitCategory;
  onOutfitSlot: (slot: OutfitCategory) => void;
  tattooPlacement: TattooPlacement;
  onTattooPlacement: (placement: TattooPlacement) => void;
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
      return <TattooPanel placement={tattooPlacement} onPlacementChange={onTattooPlacement} />;
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
  revealTattoo,
  insetLeft,
  quality,
  onSettled,
  onCaughtUp,
}: {
  manifest: MhManifest;
  focus: CameraFocus;
  revealTattoo: TattooPlacement | null;
  insetLeft: number;
  quality: QualityPreference;
  onSettled: () => void;
  onCaughtUp: (caughtUp: boolean) => void;
}) {
  const config = useDeferredValue(useCreatorStore((state) => state.config));
  return (
    <MhStage
      config={config}
      manifest={manifest}
      mode="creator"
      focus={focus}
      revealTattoo={revealTattoo}
      insetLeft={insetLeft}
      quality={quality}
      onSettled={onSettled}
      onCaughtUp={onCaughtUp}
      className="size-full"
    />
  );
}

/** Runs `run` once when mounted (a render-function fallback cannot set state itself). */
function OnMount({ run }: { run: () => void }) {
  useEffect(() => run(), [run]);
  return null;
}

/**
 * A tally light and one short mono status line: green when saved, cobalt
 * breathing while saving. The long forms (why a draft is only in this tab,
 * that a failed save is retried) are told in full where they matter: under
 * the name field, and to assistive tech here.
 */
function AutosaveNote({ status }: { status: ReturnType<typeof useAutosave>['status'] }) {
  const t = useTranslations('Creator.autosave');
  if (status === 'idle') return null;
  const text = {
    needsName: t('short.needsName'),
    pending: t('pending'),
    saving: t('saving'),
    saved: t('saved'),
    error: t('short.error'),
  }[status];
  const full = status === 'error' ? t('error') : status === 'needsName' ? t('needsName') : null;
  const busy = status === 'pending' || status === 'saving';
  return (
    <p
      role="status"
      title={full ?? undefined}
      className={cn(
        'flex min-w-0 items-center justify-end gap-2 font-mono text-[11px] tracking-[0.08em] whitespace-nowrap uppercase',
        status === 'error' ? 'text-ink' : status === 'saved' ? 'text-ink-muted' : 'text-ink-faint',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          status === 'error'
            ? 'bg-alert'
            : busy
              ? 'bg-cobalt animate-pulse'
              : status === 'saved'
                ? 'bg-ok'
                : 'shadow-[inset_0_0_0_1px_var(--color-ink-faint)]',
        )}
      />
      <span className="truncate" aria-hidden={full ? true : undefined}>
        {text}
      </span>
      {full ? <span className="sr-only">{full}</span> : null}
    </p>
  );
}

function ManifestPlaceholder({ state }: { state: ManifestState }) {
  const t = useTranslations('Creator.manifest');
  if (state.status === 'loading' || state.status === 'ready') {
    return (
      <div role="status" aria-live="polite" className="flex flex-col gap-3">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-3 w-24 rounded-full" />
        {/* Same shape as the first category: two 3:4 portraits with a label line under each. */}
        <div className="grid grid-cols-2 gap-x-2.5 gap-y-3.5">
          {Array.from({ length: 2 }, (_, index) => (
            <div key={index} className="flex flex-col gap-2">
              <Skeleton className="aspect-[3/4] w-full" />
              <Skeleton className="h-3 w-2/3 rounded-full" />
            </div>
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
          <Button type="button" variant="quiet" onClick={state.retry}>
            {t('retry')}
          </Button>
          {state.fixtureAvailable ? (
            <Button asChild variant="primary">
              <a href="?fixture=1">{t('useFixture')}</a>
            </Button>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div role="alert" className="flex flex-col items-start gap-4 pt-2">
      <p className="text-title text-ink">{t('errorTitle')}</p>
      <Button type="button" variant="quiet" onClick={state.retry}>
        {t('retry')}
      </Button>
    </div>
  );
}
