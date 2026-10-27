'use client';

import { ArrowClockwiseIcon, ImageIcon, PlayIcon, StopIcon } from '@phosphor-icons/react';
import { NextIntlClientProvider, useTranslations, type AbstractIntlMessages } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { thumbConfig, thumbShot } from '@/components/dev/thumbConfig';
import { type ThumbKind, type ThumbTarget } from '@/components/dev/thumbTargets';
import { StageBoundary } from '@/components/stage/StageBoundary';
import { Button } from '@/components/ui/button';
import { MhStage } from '@/features/avatar/mh/MhStage';
import { useMhManifest } from '@/features/creator/useMhManifest';
import { assetUrl, labelFor, type MhManifest } from '@/lib/assets/manifest';
import { cn } from '@/lib/utils';

import { cameraFor, poseDistance, shotBox, squareFov, type CameraPose } from './framing';
import {
  aimCamera,
  cameraPosition,
  jointsMoved,
  measureJoints,
  measureLandmarks,
  onStage,
  viewOf,
} from './sceneProbe';
import { GRID, lumaOf, SETTLE_RULE, settleBlocker, type SettleBlocker } from './settle';

/** Output size and quality of every thumbnail. */
const THUMB_PX = 512;
const QUALITY = 0.85;
/** How often the settling stage is sampled (see settle.ts). */
const SAMPLE_MS = 400;
/** A joint or the camera moving more than this (m) since the last framing re-frames the shot. */
const REFRAME_M = 0.002;
/** A stage that does not settle in this time counts as failed (and is retried once). */
const READY_TIMEOUT_MS = 60_000;
/**
 * Renders per page load. Every job mounts a fresh WebGL stage, and the stage's
 * texture loaders keep their workers, so a long batch slows down until jobs
 * time out. Reloading between chunks (the queue survives in sessionStorage)
 * frees them.
 */
const CHUNK = 12;
const BATCH_KEY = 'ai-sims:dev-thumbs-batch';

interface SavedBatch {
  queue: string[];
  states: Record<string, ItemState>;
  retried: string[];
  /** The kind filter, so the list a recycled page shows is the one being rendered. */
  kinds?: ThumbKind[];
}

function takeSavedBatch(): SavedBatch | null {
  try {
    const raw = window.sessionStorage.getItem(BATCH_KEY);
    window.sessionStorage.removeItem(BATCH_KEY);
    return raw ? (JSON.parse(raw) as SavedBatch) : null;
  } catch {
    return null;
  }
}

function clearBatch(): void {
  try {
    window.sessionStorage.removeItem(BATCH_KEY);
  } catch {
    // Storage unavailable: nothing to clear.
  }
}

function saveBatch(batch: SavedBatch): boolean {
  try {
    window.sessionStorage.setItem(BATCH_KEY, JSON.stringify(batch));
    return true;
  } catch {
    return false;
  }
}
const KIND_ORDER: ThumbKind[] = ['face', 'hair', 'eyebrows', 'beard', 'mustache', 'outfit'];

interface ListItem extends ThumbTarget {
  exists: boolean;
  backup: boolean;
  writable: boolean;
}

type ErrorKind = 'timeout' | 'stage' | 'capture' | 'upload' | 'network' | 'config';
type Outcome = { ok: true; backedUp: boolean } | { ok: false; error: ErrorKind; code?: string };

interface ItemState {
  status: 'idle' | 'queued' | 'rendering' | 'done' | 'failed';
  error?: ErrorKind;
  code?: string;
  /** Bumped on every write so the preview skips the cached image. */
  version?: number;
}

export function ThumbsBench({ messages }: { messages: AbstractIntlMessages }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <Bench />
    </NextIntlClientProvider>
  );
}

function Bench() {
  const t = useTranslations('DevThumbs');
  const manifestState = useMhManifest({ curated: false });
  const manifest = manifestState.status === 'ready' ? manifestState.manifest : undefined;
  const [items, setItems] = useState<ListItem[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [states, setStates] = useState<Record<string, ItemState>>({});
  const [queue, setQueue] = useState<string[]>([]);
  const [ran, setRan] = useState(false);
  /** Ids already retried once after a failure in this batch. */
  const [retried, setRetried] = useState<string[]>([]);
  /** Jobs finished since this page loaded (see CHUNK). */
  const [sinceLoad, setSinceLoad] = useState(0);
  /** Kinds the list and the render buttons are limited to; empty means every kind. */
  const [kinds, setKinds] = useState<readonly ThumbKind[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch('/api/dev/thumbnails', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Thumbnail list failed: ${response.status}`);
        const body = (await response.json()) as { items: ListItem[] };
        setItems(body.items);
        setListFailed(false);
        // Resume a batch interrupted by a recycling reload.
        const saved = takeSavedBatch();
        if (saved && saved.queue.length > 0) {
          setStates(saved.states);
          setRetried(saved.retried);
          setQueue(saved.queue);
          setKinds(saved.kinds ?? []);
          setRan(true);
        }
      } catch {
        if (!controller.signal.aborted) setListFailed(true);
      }
    };
    void load();
    return () => controller.abort();
  }, [attempt]);

  const byId = useMemo(() => new Map((items ?? []).map((item) => [item.id, item])), [items]);
  const current = queue.length > 0 ? byId.get(queue[0]) : undefined;

  const enqueue = (ids: string[]) => {
    if (ids.length === 0) return;
    setRan(true);
    if (queue.length === 0) setRetried([]);
    setStates((previous) => {
      const next = { ...previous };
      for (const id of ids) next[id] = { ...next[id], status: 'queued', error: undefined };
      return next;
    });
    setQueue((previous) => [...previous, ...ids.filter((id) => !previous.includes(id))]);
  };

  const stop = () => {
    setStates((previous) => {
      const next = { ...previous };
      for (const id of queue.slice(1)) next[id] = { ...next[id], status: 'idle' };
      return next;
    });
    setQueue((previous) => previous.slice(0, 1));
  };

  // The head of the queue is the one rendering.
  const stateOf = (id: string): ItemState | undefined =>
    id === current?.id ? { ...states[id], status: 'rendering' } : states[id];

  const onFinished = useCallback(
    (id: string, outcome: Outcome) => {
      setSinceLoad((count) => count + 1);
      // A first failure goes to the back of the queue for one more try.
      if (!outcome.ok && !retried.includes(id)) {
        setRetried((previous) => [...previous, id]);
        setStates((previous) => ({ ...previous, [id]: { ...previous[id], status: 'queued' } }));
        setQueue((previous) => (previous[0] === id ? [...previous.slice(1), id] : previous));
        return;
      }
      setStates((previous) => ({
        ...previous,
        [id]: outcome.ok
          ? { status: 'done', version: Date.now() }
          : { ...previous[id], status: 'failed', error: outcome.error, code: outcome.code },
      }));
      if (outcome.ok) {
        setItems((previous) =>
          (previous ?? []).map((item) =>
            item.id === id
              ? { ...item, exists: true, backup: item.backup || outcome.backedUp }
              : item,
          ),
        );
      }
      setQueue((previous) => (previous[0] === id ? previous.slice(1) : previous));
    },
    [retried],
  );

  // The running batch lives in the session too, so an unplanned reload (a
  // dev-server full refresh) resumes it instead of dropping it. Only once the
  // list has loaded: before that the saved batch has not been taken yet.
  useEffect(() => {
    if (!items) return;
    if (queue.length > 0) saveBatch({ queue, states, retried, kinds: [...kinds] });
    else clearBatch();
  }, [items, queue, states, retried, kinds]);

  // Between jobs, after CHUNK renders, hand the rest of the batch to a fresh page.
  const recycle = queue.length > 0 && sinceLoad >= CHUNK;
  useEffect(() => {
    if (!recycle) return;
    if (saveBatch({ queue, states, retried, kinds: [...kinds] })) window.location.reload();
  }, [recycle, queue, states, retried, kinds]);

  const all = (items ?? []).filter((item) => kinds.length === 0 || kinds.includes(item.kind));
  const present = KIND_ORDER.filter((kind) => items?.some((item) => item.kind === kind));
  const toggleKind = (kind: ThumbKind) =>
    setKinds((previous) =>
      previous.includes(kind) ? previous.filter((entry) => entry !== kind) : [...previous, kind],
    );
  const done = all.filter((item) => states[item.id]?.status === 'done').length;
  const failed = all.filter((item) => states[item.id]?.status === 'failed').length;
  const notInManifest = all.filter((item) => !item.inManifest);
  const running = queue.length > 0;
  const planned = all.filter((item) => states[item.id] && states[item.id].status !== 'idle').length;

  return (
    <div className="flex h-full flex-col lg:flex-row">
      <aside className="border-hairline flex shrink-0 flex-col gap-5 overflow-y-auto border-b p-6 lg:w-[576px] lg:border-r lg:border-b-0">
        <div>
          <h1 className="font-headline text-headline text-ink">{t('title')}</h1>
          <p className="text-body-sm text-ink-muted mt-2 max-w-[56ch]">{t('lede')}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="primary"
            disabled={!manifest || !items || running}
            onClick={() => enqueue(all.filter((item) => item.writable).map((item) => item.id))}
          >
            <PlayIcon weight="fill" aria-hidden="true" />
            {t('renderAll')}
          </Button>
          <Button
            type="button"
            variant="quiet"
            disabled={!manifest || !items || running}
            onClick={() =>
              enqueue(all.filter((item) => item.writable && !item.exists).map((item) => item.id))
            }
          >
            {t('renderMissing')}
          </Button>
          {running ? (
            <Button type="button" variant="ghost" onClick={stop}>
              <StopIcon weight="fill" aria-hidden="true" />
              {t('stop')}
            </Button>
          ) : null}
        </div>

        {present.length > 1 ? (
          <div role="group" aria-label={t('kindFilter.label')} className="flex flex-wrap gap-2">
            <KindChip active={kinds.length === 0} disabled={running} onClick={() => setKinds([])}>
              {t('kindFilter.all')}
            </KindChip>
            {present.map((kind) => (
              <KindChip
                key={kind}
                active={kinds.includes(kind)}
                disabled={running}
                onClick={() => toggleKind(kind)}
              >
                {t(`kinds.${kind}`)}
              </KindChip>
            ))}
          </div>
        ) : null}

        <div className="flex flex-col gap-2" aria-live="polite">
          <div className="bg-paper-lift h-1 overflow-hidden rounded-full">
            <div
              className="bg-cobalt h-full transition-[width] duration-300"
              style={{ width: planned ? `${(100 * (done + failed)) / planned}%` : '0%' }}
            />
          </div>
          <p className="text-label text-ink-muted">
            {running && current
              ? t('running', { label: labelOf(manifest, current) })
              : ran
                ? t('finished')
                : t('idle')}
            {planned ? ` · ${t('progress', { done: done + failed, total: planned })}` : ''}
            {failed ? ` · ${t('failedCount', { count: failed })}` : ''}
          </p>
          {notInManifest.length > 0 ? (
            <p className="text-label text-cobalt">
              {t('notInManifestCount', { count: notInManifest.length })}
            </p>
          ) : null}
        </div>

        <section
          aria-label={t('stageLabel')}
          className="rounded-tile border-hairline bg-paper-deep relative size-[512px] max-w-full shrink-0 overflow-hidden border"
        >
          {manifest && current && !recycle ? (
            <RenderJob
              // A retried item can come back to the head of the queue: remount it.
              key={`${current.id}#${sinceLoad}`}
              manifest={manifest}
              target={current}
              onFinished={onFinished}
            />
          ) : (
            <div className="text-ink-faint flex size-full items-center justify-center">
              <ImageIcon className="size-12" weight="thin" aria-hidden="true" />
            </div>
          )}
        </section>
      </aside>

      <main className="min-h-0 flex-1 overflow-y-auto p-6" aria-label={t('listLabel')}>
        {manifestState.status === 'loading' || (!items && !listFailed) ? (
          <p className="text-body-sm text-ink-muted" role="status">
            {t('loading')}
          </p>
        ) : manifestState.status === 'missing' ? (
          <p className="text-body-sm text-ink-muted">{t('manifestMissing')}</p>
        ) : listFailed || manifestState.status === 'error' ? (
          <div role="alert" className="flex items-center gap-3">
            <p className="text-body-sm text-ink-muted">{t('listFailed')}</p>
            <Button
              type="button"
              variant="quiet"
              size="sm"
              onClick={() => {
                setAttempt((value) => value + 1);
                if (manifestState.status === 'error') manifestState.retry();
              }}
            >
              {t('reload')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-10">
            {KIND_ORDER.map((kind) => {
              const group = all.filter((item) => item.kind === kind);
              if (group.length === 0) return null;
              return (
                <section key={kind} aria-labelledby={`thumbs-${kind}`}>
                  <h2 id={`thumbs-${kind}`} className="text-ui text-ink mb-3">
                    {t(`kinds.${kind}`)}
                    <span className="text-label text-ink-faint ml-2">{group.length}</span>
                  </h2>
                  <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
                    {group.map((item) => (
                      <ThumbTile
                        key={item.id}
                        item={item}
                        label={labelOf(manifest, item)}
                        state={stateOf(item.id)}
                        onRender={() => enqueue([item.id])}
                      />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

function labelOf(manifest: MhManifest | undefined, target: ThumbTarget): string {
  const entry =
    manifest?.faces.find((face) => face.id === target.id) ??
    manifest?.grooms.find((groom) => groom.id === target.id) ??
    manifest?.outfits.find((outfit) => outfit.id === target.id);
  return entry ? labelFor(entry.label, 'en') : target.id;
}

/** A toggle in the kind filter (several can be on at once). */
function KindChip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-tile text-ui h-9 border px-3.5 transition-colors duration-200 disabled:opacity-40',
        active
          ? 'border-cobalt bg-paper-lift text-ink'
          : 'border-hairline text-ink-muted hover:border-ink-faint hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

function ThumbTile({
  item,
  label,
  state,
  onRender,
}: {
  item: ListItem;
  label: string;
  state: ItemState | undefined;
  onRender: () => void;
}) {
  const t = useTranslations('DevThumbs');
  const status = state?.status ?? 'idle';
  const src = item.exists ? `${assetUrl(item.file)}?v=${state?.version ?? 0}` : undefined;
  return (
    <li className="rounded-tile border-hairline bg-paper-raised flex flex-col overflow-hidden border">
      <div className="bg-paper-deep relative aspect-square">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- a just-written local file, cache-busted
          <img src={src} alt="" className="size-full object-cover" />
        ) : (
          <span className="text-label text-ink-faint flex size-full items-center justify-center">
            {t('badges.noFile')}
          </span>
        )}
        {status === 'rendering' || status === 'queued' ? (
          <span className="bg-paper/80 text-label text-ink absolute inset-x-2 top-2 rounded-[5px] px-2 py-1">
            {t(`status.${status}`)}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-1 p-2.5">
        <p className="text-ui text-ink truncate" title={item.id}>
          {label}
        </p>
        <p
          className={cn(
            'text-label',
            status === 'failed'
              ? 'text-alert'
              : status === 'done'
                ? 'text-cobalt'
                : 'text-ink-faint',
          )}
        >
          {t(`status.${status}`)}
        </p>
        {status === 'failed' && state?.error ? (
          <p className="text-label text-ink-muted">
            {t(`errors.${state.error}`, { code: state.code ?? '' })}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-1">
          {!item.inManifest ? <Badge>{t('badges.notInManifest')}</Badge> : null}
          {item.backup ? <Badge>{t('badges.backup')}</Badge> : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 self-start px-2"
          disabled={!item.writable || status === 'queued' || status === 'rendering'}
          onClick={onRender}
        >
          <ArrowClockwiseIcon aria-hidden="true" />
          {status === 'failed' ? t('retry') : t('render')}
        </Button>
      </div>
    </li>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="border-hairline text-label text-ink-muted rounded-[5px] border px-1.5 py-0.5">
      {children}
    </span>
  );
}

/**
 * One render: mounts a fresh stage for the target, waits for its first frame
 * and then for the picture to settle (textures and grooms stream in later),
 * reads the canvas into a square WebP and posts it.
 */
function RenderJob({
  manifest,
  target,
  onFinished,
}: {
  manifest: MhManifest;
  target: ThumbTarget;
  onFinished: (id: string, outcome: Outcome) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const alive = useRef(false);
  const finished = useRef(false);
  const config = useMemo(() => thumbConfig(manifest, target), [manifest, target]);

  const finish = useCallback(
    (outcome: Outcome) => {
      if (!alive.current || finished.current) return;
      finished.current = true;
      onFinished(target.id, outcome);
    },
    [onFinished, target.id],
  );

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!config) {
      finish({ ok: false, error: 'config' });
      return undefined;
    }
    // The code says what it was still waiting for (see settle.ts).
    const timer = window.setTimeout(
      () => finish({ ok: false, error: 'timeout', code: blocker.current }),
      READY_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [config, finish]);

  // What the settle loop is still waiting for, reported on a timeout.
  const blocker = useRef<
    SettleBlocker | 'settled' | 'character' | 'groom' | 'outfit' | 'pose' | 'framing' | 'ready'
  >('ready');
  // Skin, iris and groom textures bound and outfits fitted (MhStage onSettled).
  const settled = useRef(false);
  const onSettled = useCallback(() => {
    settled.current = true;
  }, []);
  // Asset responses (textures, grooms) keep arriving after the first frame.
  const lastAsset = useRef(0);
  useEffect(() => {
    lastAsset.current = performance.now();
    const observer = new PerformanceObserver((list) => {
      if (list.getEntries().some((entry) => entry.name.includes('/assets/mh/'))) {
        lastAsset.current = performance.now();
      }
    });
    observer.observe({ type: 'resource', buffered: false });
    return () => observer.disconnect();
  }, []);

  const onReady = useCallback(() => {
    // A probe that throws fails the job instead of leaving it to time out.
    settleThenCapture().catch((error: unknown) => {
      console.warn('[thumbs] settle failed', error);
      finish({ ok: false, error: 'stage', code: 'probe' });
    });

    async function settleThenCapture() {
      let calm = 0;
      let previous: Float32Array | null = null;
      // The pose and camera the shot was last framed for.
      let framedJoints: ReturnType<typeof measureJoints> = null;
      let aimed: CameraPose | null = null;
      const shot = thumbShot(target);
      while (alive.current && calm < SETTLE_RULE.calmSamples) {
        await sleep(SAMPLE_MS);
        const canvas = box.current?.querySelector('canvas');
        if (!canvas) continue;
        const wait = (why: typeof blocker.current) => {
          blocker.current = why;
          calm = 0;
          previous = null;
        };
        // Skin, iris and groom textures (KTX2) bound, grooms and outfits fitted.
        if (!settled.current) {
          wait('settled');
          continue;
        }
        // The picture alone cannot tell a bald head from one whose hair is
        // still being fitted: wait until the item is actually in the scene.
        if (!onStage(canvas, target)) {
          wait(
            target.kind === 'face' ? 'character' : target.kind === 'outfit' ? 'outfit' : 'groom',
          );
          continue;
        }
        // Idle clips and details still streaming in would change the pose or the look.
        const sinceAssetMs = performance.now() - lastAsset.current;
        if (sinceAssetMs < SETTLE_RULE.quietMs) {
          wait('assets');
          continue;
        }
        // Frame on the figure, again whenever the pose or the camera moved.
        const joints = measureJoints(canvas);
        if (!joints) {
          wait('pose');
          continue;
        }
        const at = cameraPosition(canvas);
        const drifted =
          !aimed || !at || poseDistance({ position: at, target: aimed.target }, aimed) > REFRAME_M;
        if (!framedJoints || jointsMoved(framedJoints, joints) > REFRAME_M || drifted) {
          const marks = measureLandmarks(canvas, joints);
          const view = viewOf(canvas);
          if (!marks || !view) {
            wait('pose');
            continue;
          }
          const pose = cameraFor(
            shotBox(shot, marks),
            squareFov(view.fov, view.width, view.height),
          );
          if (!aimCamera(canvas, pose)) {
            wait('framing');
            continue;
          }
          framedJoints = joints;
          aimed = pose;
          wait('framing');
          continue;
        }
        const luma = sampleLuma(canvas);
        if (!luma) continue;
        const why = settleBlocker({ luma, previous, sinceAssetMs });
        blocker.current = why ?? blocker.current;
        calm = why === null ? calm + 1 : 0;
        previous = luma;
      }
      if (alive.current) await capture();
    }

    async function capture() {
      const canvas = box.current?.querySelector('canvas');
      const blob = canvas ? await squareWebp(canvas) : null;
      if (!blob) {
        finish({ ok: false, error: 'capture' });
        return;
      }
      try {
        const response = await fetch(`/api/dev/thumbnails?id=${encodeURIComponent(target.id)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'image/webp' },
          body: blob,
        });
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          backedUp?: boolean;
        };
        if (!response.ok) {
          finish({ ok: false, error: 'upload', code: body.error ?? String(response.status) });
          return;
        }
        finish({ ok: true, backedUp: Boolean(body.backedUp) });
      } catch {
        finish({ ok: false, error: 'network' });
      }
    }
  }, [finish, target]);

  if (!config) return null;
  return (
    <div ref={box} className="size-full">
      <StageBoundary
        fallback={() => <ReportFailure onFailure={() => finish({ ok: false, error: 'stage' })} />}
      >
        <MhStage
          config={config}
          manifest={manifest}
          mode="thumbnail"
          // The bench aims the camera itself once the figure is measured
          // (framing.ts); any framing that is not a close-up leaves it alone.
          focus="body"
          // A fixed tier: the auto tier would step resolution and hair detail
          // down mid-batch and make thumbnails differ.
          quality="high"
          onReady={onReady}
          onSettled={onSettled}
          className="size-full"
        />
      </StageBoundary>
    </div>
  );
}

function ReportFailure({ onFailure }: { onFailure: () => void }) {
  useEffect(() => onFailure(), [onFailure]);
  return null;
}

/**
 * Centre square of the stage canvas, scaled to THUMB_PX, as WebP. Null when
 * the canvas reads back blank (a cleared drawing buffer or a lost context).
 */
async function squareWebp(source: HTMLCanvasElement): Promise<Blob | null> {
  const side = Math.min(source.width, source.height);
  if (side === 0) return null;
  const out = document.createElement('canvas');
  out.width = THUMB_PX;
  out.height = THUMB_PX;
  const context = out.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    source,
    (source.width - side) / 2,
    (source.height - side) / 2,
    side,
    side,
    0,
    0,
    THUMB_PX,
    THUMB_PX,
  );
  if (isBlank(context.getImageData(0, 0, THUMB_PX, THUMB_PX).data)) return null;
  return new Promise((resolve) => out.toBlob(resolve, 'image/webp', QUALITY));
}

/** True when a coarse grid of pixels is all one value (nothing was drawn). */
function isBlank(pixels: Uint8ClampedArray): boolean {
  const first = pixels[0] + pixels[1] + pixels[2] + pixels[3];
  for (let y = 16; y < THUMB_PX; y += 32) {
    for (let x = 16; x < THUMB_PX; x += 32) {
      const index = (y * THUMB_PX + x) * 4;
      const value = pixels[index] + pixels[index + 1] + pixels[index + 2] + pixels[index + 3];
      if (Math.abs(value - first) > 6) return false;
    }
  }
  return true;
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/** The centre square of the stage canvas as a GRID x GRID luma sample. */
function sampleLuma(source: HTMLCanvasElement): Float32Array | null {
  const side = Math.min(source.width, source.height);
  if (side === 0) return null;
  const grid = document.createElement('canvas');
  grid.width = GRID;
  grid.height = GRID;
  const context = grid.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(
    source,
    (source.width - side) / 2,
    (source.height - side) / 2,
    side,
    side,
    0,
    0,
    GRID,
    GRID,
  );
  return lumaOf(context.getImageData(0, 0, GRID, GRID).data);
}
