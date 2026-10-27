'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Vector3 } from 'three';

import { irisFor } from '@/components/dev/thumbConfig';
import { StageBoundary } from '@/components/stage/StageBoundary';
import { Button } from '@/components/ui/button';
import type { MhCharacterHandle } from '@/features/avatar/mh/MhCharacter';
import { MhStage } from '@/features/avatar/mh/MhStage';
import { MIN_CALM_IDLES } from '@/features/avatar/mh/resolve';
import { presetSliders, reconcileConfig, startingConfig } from '@/features/creator/reconcile';
import { useMhManifest } from '@/features/creator/useMhManifest';
import type { MhManifest, OutfitCategory } from '@/lib/assets/manifest';
import {
  BODY_PRESETS,
  BODY_SLIDERS,
  type BodyPreset,
  type BodySlider,
  type CharacterConfig,
} from '@/lib/character/schema';
import { encodeSilhouette } from '@/lib/silhouette/format';

import { collectFigure, leanOf, measurePosture, type PoseCheck, type Posture } from './collect';
import { keepOuterShell, normalizeFigure, sampleSurfaces } from './sampling';

/**
 * Samples the landing silhouette (public/assets/landing/silhouette.bin) from
 * a real assembled MetaHuman: one character held in one frame of its idle,
 * points spread over what a viewer sees of it. Dev layout: `next dev` only.
 *
 * Query params (all optional): face, hair, brows, top, bottom, shoes (manifest
 * ids, `none` for nothing), body (a creator body preset), height, weight,
 * muscle, chest, waist, hips, shoulders (slider values over the preset's),
 * clip (body animation id), t (seconds into the clip), upright (1 always
 * stands the figure upright, 0 never; by default only when the frame leans
 * past MAX_TILT_DEG, see collectFigure), n (points), seed. "Scan clip" lists
 * the clip's most upright frames: pick t from those.
 */

const DEFAULTS = {
  face: 'face.Ada',
  hair: 'groom.hair.Hair_M_BobStraight',
  // Empty: the base's natural brow (startingConfig).
  brows: '',
  top: 'outfit.OA_Crewneckt',
  bottom: 'outfit.OA_Jeans_slm',
  shoes: 'outfit.OA_CasualSneakers',
  body: 'athletic',
  clip: 'anim.fab.actorcore_idle.relax',
  // The most upright frame of `relax` (Scan clip): weight on both feet, shoulders level.
  t: 15.8,
  n: 8000,
  seed: 1,
};
/**
 * Slider values over the body preset's, unless the query sets them: the
 * creator's athletic woman, a little leaner (the landing figure read heavy
 * on the average body).
 */
const BODY_NUDGE: Partial<Record<BodySlider, number>> = { weight: -1, muscle: 0.75, waist: -0.7 };
/** Head and neck triangles count this many times: the face reads at landing scale. */
const HEAD_WEIGHT = 2;
/** Hair cards, scalp and a waistband deeper than this (m) under the outermost layer are not seen. */
const SHELL_DEPTH = 0.01;
/**
 * An upper arm further than this from hanging straight down (degrees) is the
 * bind A-pose, not the idle: the bench refuses to save it.
 */
const MAX_ARM_DEG = 25;
/**
 * The body's axis (pelvis to crown) and the trunk (pelvis to neck) may lean
 * this much (degrees) in either view as sampled. Neck to head is not held to
 * it: the neck joint sits at the back of the neck, so that line leans ~15°
 * forward in any natural stance.
 */
const MAX_TILT_DEG = 3;
/** Clip time step (s) of a posture scan. */
const SCAN_STEP = 0.2;
/** The held pose counts as drawn once the wrists move less than this (m) over STEADY_POLLS polls. */
const STEADY_M = 0.0005;
const STEADY_POLLS = 3;
const POLL_MS = 200;
const OUTFIT_SLOTS = ['top', 'bottom', 'shoes'] as const;

interface BenchParams {
  face: string;
  hair: string | null;
  brows: string | null;
  outfit: Record<(typeof OUTFIT_SLOTS)[number], string | null>;
  body: BodyPreset;
  /** Slider values set over the preset's. */
  sliders: Partial<Record<BodySlider, number>>;
  clip: string;
  at: number;
  upright: 'auto' | 'always' | 'never';
  count: number;
  seed: number;
}

function readParams(search: URLSearchParams): BenchParams {
  const id = (key: keyof typeof DEFAULTS) => {
    const value = search.get(key) ?? String(DEFAULTS[key]);
    return value === '' || value === 'none' ? null : value;
  };
  const number = (key: 't' | 'n' | 'seed', valid: (value: number) => boolean) => {
    const value = Number(search.get(key) ?? DEFAULTS[key]);
    return Number.isFinite(value) && valid(value) ? value : DEFAULTS[key];
  };
  const body = id('body');
  const sliders: Partial<Record<BodySlider, number>> = { ...BODY_NUDGE };
  for (const slider of BODY_SLIDERS) {
    const value = Number(search.get(slider) ?? Number.NaN);
    if (Number.isFinite(value)) sliders[slider] = Math.min(1, Math.max(-1, value));
  }
  return {
    face: id('face') ?? DEFAULTS.face,
    hair: id('hair'),
    brows: id('brows'),
    outfit: { top: id('top'), bottom: id('bottom'), shoes: id('shoes') },
    body: BODY_PRESETS.find((preset) => preset === body) ?? 'average',
    sliders,
    clip: id('clip') ?? DEFAULTS.clip,
    at: number('t', (value) => value >= 0),
    upright:
      search.get('upright') === '1' ? 'always' : search.get('upright') === '0' ? 'never' : 'auto',
    count: Math.round(number('n', (value) => value >= 100 && value <= 30000)),
    seed: Math.round(number('seed', () => true)),
  };
}

/**
 * The manifest with the chosen clip as the only body animation, listed
 * MIN_CALM_IDLES times so it drives the whole body (resolve.ts idleSet); a
 * thumbnail stage plays the first. Face loops stay.
 */
function withClip(manifest: MhManifest, clipId: string): MhManifest | null {
  const clip = manifest.animations.find((entry) => entry.id === clipId && entry.kind === 'body');
  if (!clip) return null;
  const tags = [...new Set([...clip.tags, 'idle', 'calm'])];
  const copies = Array.from({ length: MIN_CALM_IDLES }, (_, i) => ({
    ...clip,
    id: i === 0 ? clip.id : `${clip.id}.${i}`,
    tags,
  }));
  return {
    ...manifest,
    animations: [...manifest.animations.filter((entry) => entry.kind !== 'body'), ...copies],
  };
}

/**
 * The character to sample: the face with its own skin and iris, neutral body
 * sliders, the chosen grooms and garments (first colourway). `changed` lists
 * the picks reconcile had to replace (unknown or incompatible ids).
 */
function benchConfig(
  manifest: MhManifest,
  params: BenchParams,
): { config: CharacterConfig; changed: string[] } | null {
  const face = manifest.faces.find((entry) => entry.id === params.face);
  if (!face) return null;
  const config = startingConfig(face.gender, manifest);
  config.face = { preset: face.id, blend: {} };
  config.skin = { set: face.defaultSkin, tone: 0, makeup: false };
  config.eyes = { iris: irisFor(manifest, face), color: null };
  // As the creator's preset picker sets them (store.setBodyPreset), then the nudges.
  config.body = {
    preset: params.body,
    sliders: { ...presetSliders(manifest, face.gender, params.body), ...params.sliders },
  };
  config.hair.style = params.hair;
  if (params.brows) config.eyebrows.style = params.brows;
  config.beard.style = null;
  config.mustache.style = null;
  config.accessories = [];
  config.tattoos = [];
  const item = (id: string | null) => {
    const outfit = id ? manifest.outfits.find((entry) => entry.id === id) : undefined;
    return outfit ? { id: outfit.id, tint: outfit.tintPresets[0]?.id ?? null, colors: {} } : null;
  };
  config.outfit = {
    top: item(params.outfit.top),
    bottom: item(params.outfit.bottom),
    shoes: item(params.outfit.shoes),
    full: null,
  };
  const reconciled = reconcileConfig(config, manifest);
  const changed: string[] = [];
  if (reconciled.hair.style !== params.hair) changed.push(`hair → ${reconciled.hair.style}`);
  for (const slot of OUTFIT_SLOTS) {
    const asked = params.outfit[slot];
    const got = reconciled.outfit[slot as OutfitCategory]?.id ?? null;
    if (asked !== got) changed.push(`${slot}: ${asked} → ${got}`);
  }
  return { config: reconciled, changed };
}

type Phase =
  'assembling' | 'posing' | 'ready' | 'scanning' | 'sampling' | 'saving' | 'saved' | 'failed';

/** Resolves after `count` drawn frames. */
const frames = (count: number) =>
  new Promise<void>((resolve) => {
    let left = count;
    const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  });

const tiltText = ({ front, side }: { front: number; side: number }) =>
  `front ${front.toFixed(1)}°, side ${side.toFixed(1)}°`;

interface Report {
  points: Float32Array;
  perSurface: { name: string; count: number }[];
  skipped: string[];
  turnDeg: number;
  height: number;
  pose: PoseCheck;
  posture: { posed: Posture; sampled: Posture };
  upright: number;
  /** Nose tip in front of the skull's centre (m) and off the middle (normalized x). */
  nose: { ahead: number; x: number } | null;
  ms: number;
}

export function SilhouetteBench() {
  const search = useSearchParams();
  const params = useMemo(() => readParams(new URLSearchParams(search.toString())), [search]);
  const manifestState = useMhManifest({ curated: false });
  const loaded = manifestState.status === 'ready' ? manifestState.manifest : undefined;
  const manifest = useMemo(
    () => (loaded ? withClip(loaded, params.clip) : null),
    [loaded, params.clip],
  );
  const built = useMemo(
    () => (manifest ? benchConfig(manifest, params) : null),
    [manifest, params],
  );

  const [phase, setPhase] = useState<Phase>('assembling');
  const [message, setMessage] = useState('');
  const [clipInfo, setClipInfo] = useState<{ name: string; duration: number } | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [scan, setScan] = useState<{ t: number; lean: number; posture: Posture }[] | null>(null);
  const handle = useRef<MhCharacterHandle | null>(null);
  const [settles, setSettles] = useState(0);
  const onCharacter = useCallback((next: MhCharacterHandle) => {
    handle.current = next;
    setSettles((count) => count + 1);
    setPhase((current) => (current === 'assembling' ? 'posing' : current));
  }, []);

  // Once settled: wait for the clip to play, pin it at `t`, then until the
  // drawn pose stops moving (the arm collision eases out of what it pushed
  // while the character was assembling).
  useEffect(() => {
    if (settles === 0) return undefined;
    let live = true;
    let timer = 0;
    let previous: number[] | null = null;
    let steady = 0;
    const poll = () => {
      if (!live) return;
      const character = handle.current;
      const motion = character?.motion;
      if (!character || !motion?.hold(params.at)) {
        timer = window.setTimeout(poll, POLL_MS);
        return;
      }
      setClipInfo({ name: motion.playing ?? '?', duration: motion.duration });
      const wrists = ['hand_l', 'hand_r'].flatMap((name) => {
        const bone = character.body.bones.get(name);
        return bone ? bone.getWorldPosition(new Vector3()).toArray() : [];
      });
      const moved = previous
        ? Math.max(...wrists.map((value, i) => Math.abs(value - previous![i]!)))
        : Infinity;
      previous = wrists;
      steady = moved < STEADY_M ? steady + 1 : 0;
      if (steady >= STEADY_POLLS) {
        setPhase((current) => (current === 'posing' ? 'ready' : current));
        return;
      }
      timer = window.setTimeout(poll, POLL_MS);
    };
    poll();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [settles, params.at]);

  const run = useCallback(
    async (save: boolean) => {
      const character = handle.current;
      if (!character) return;
      setPhase('sampling');
      setMessage('');
      try {
        const started = performance.now();
        const figure = collectFigure(character, { upright: params.upright, slack: MAX_TILT_DEG });
        let surfaces = keepOuterShell(figure.surfaces, {
          group: 'head',
          around: 'point',
          centre: figure.skull,
          depth: SHELL_DEPTH,
          above: figure.neckY,
        });
        if (figure.waist) {
          surfaces = keepOuterShell(surfaces, {
            group: 'waist',
            around: 'axis',
            centre: figure.pelvis,
            depth: SHELL_DEPTH,
            ...figure.waist,
          });
        }
        const sampled = sampleSurfaces(surfaces, {
          count: params.count,
          seed: params.seed,
          region: { above: figure.neckY, weight: HEAD_WEIGHT },
        });
        const normalized = normalizeFigure(sampled.points);
        setReport({
          points: normalized.points,
          perSurface: surfaces.map((surface, i) => ({
            name: `${surface.name} · ${surface.indices.length / 3}/${figure.surfaces[i]!.indices.length / 3} tris`,
            count: sampled.perSurface[i] ?? 0,
          })),
          skipped: figure.skipped,
          turnDeg: (figure.turn * 180) / Math.PI,
          height: normalized.height,
          pose: figure.pose,
          posture: figure.posture,
          upright: figure.upright,
          nose: figure.nose
            ? {
                ahead: figure.nose[2] - figure.skull[2],
                x: (figure.nose[0] - normalized.centre.x) / (normalized.height / 2),
              }
            : null,
          ms: performance.now() - started,
        });
        if (!save) {
          setPhase('ready');
          return;
        }
        const armDeg = Math.max(...figure.pose.armDeg);
        if (armDeg > MAX_ARM_DEG) {
          throw new Error(`not saved: arms ${armDeg.toFixed(0)}° from the sides (A-pose?)`);
        }
        if (!figure.nose || figure.nose[2] - figure.skull[2] < 0.05) {
          throw new Error('not saved: the face is not toward +z');
        }
        // The body's axis and the trunk stand within MAX_TILT_DEG of vertical in both views.
        const { axis, trunk } = figure.posture.sampled;
        for (const [name, tilt] of [
          ['body axis', axis],
          ['trunk', trunk],
        ] as const) {
          if (Math.max(Math.abs(tilt.front), Math.abs(tilt.side)) > MAX_TILT_DEG) {
            throw new Error(`not saved: the ${name} leans (${tiltText(tilt)})`);
          }
        }
        setPhase('saving');
        const response = await fetch('/api/dev/silhouette', {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: encodeSilhouette(normalized.points),
        });
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          points?: number;
          bytes?: number;
        };
        if (!response.ok) throw new Error(`save failed: ${body.error ?? response.status}`);
        setMessage(`saved ${body.points} points, ${body.bytes} bytes`);
        setPhase('saved');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
        setPhase('failed');
      }
    },
    [params.count, params.seed, params.upright],
  );

  // Holds every SCAN_STEP of the clip in turn and measures how upright it stands.
  const scanClip = useCallback(async () => {
    const character = handle.current;
    const motion = character?.motion;
    if (!character || !motion) return;
    setPhase('scanning');
    const results: { t: number; lean: number; posture: Posture }[] = [];
    try {
      for (let t = 0; t < motion.duration; t += SCAN_STEP) {
        motion.hold(t);
        await frames(2);
        const posture = measurePosture(character);
        results.push({ t: Number(t.toFixed(2)), lean: leanOf(posture), posture });
      }
      setScan(results.sort((a, b) => a.lean - b.lean).slice(0, 6));
      setPhase('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setPhase('failed');
    } finally {
      motion.hold(params.at);
      await frames(2);
    }
  }, [params.at]);

  if (manifestState.status === 'loading') return <p className="p-6 text-sm">loading manifest…</p>;
  if (manifestState.status !== 'ready') {
    return <p className="p-6 text-sm">manifest unavailable ({manifestState.status})</p>;
  }
  if (!manifest) return <p className="p-6 text-sm">no body clip {params.clip} in the manifest</p>;
  if (!built) return <p className="p-6 text-sm">no face {params.face} in the manifest</p>;

  const busy = phase === 'sampling' || phase === 'saving';
  const canSample = phase === 'ready' || phase === 'saved' || phase === 'failed';
  return (
    <div className="flex h-full gap-6 overflow-auto p-6">
      <section
        aria-label="Stage"
        className="rounded-tile border-hairline bg-paper-deep h-[720px] w-[420px] shrink-0 overflow-hidden border"
      >
        <StageBoundary fallback={() => <p className="p-4 text-sm">stage failed</p>}>
          <MhStage
            config={built.config}
            manifest={manifest}
            mode="thumbnail"
            focus="body"
            quality="high"
            backdrop="light"
            onCharacter={onCharacter}
            className="size-full"
          />
        </StageBoundary>
      </section>

      <section aria-label="Silhouette" className="flex min-w-0 flex-col gap-4 text-sm">
        <div>
          <h1 className="font-headline text-headline text-ink">Landing silhouette</h1>
          <p className="text-ink-muted mt-1 max-w-[60ch]">
            {params.count} points from {built.config.face.preset}, {params.clip} held at {params.at}{' '}
            s, seed {params.seed}. Saves public/assets/landing/silhouette.bin.
          </p>
          <p data-testid="body" className="text-ink-muted mt-1">
            body {built.config.body.preset}:{' '}
            {Object.entries(built.config.body.sliders)
              .map(([slider, value]) => `${slider} ${value}`)
              .join(', ')}
          </p>
          {built.changed.length > 0 ? (
            <p className="text-alert mt-1">replaced: {built.changed.join(', ')}</p>
          ) : null}
        </div>

        <p data-testid="status" data-phase={phase} className="text-ink" aria-live="polite">
          {phase}
          {clipInfo ? ` · clip ${clipInfo.name} (${clipInfo.duration.toFixed(2)} s)` : ''}
          {message ? ` · ${message}` : ''}
        </p>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="primary"
            data-testid="sample-save"
            disabled={!canSample || busy}
            onClick={() => void run(true)}
          >
            Sample &amp; save
          </Button>
          <Button
            type="button"
            variant="quiet"
            disabled={!canSample || busy}
            onClick={() => void run(false)}
          >
            Sample only
          </Button>
          <Button
            type="button"
            variant="quiet"
            data-testid="scan"
            disabled={!canSample || busy}
            onClick={() => void scanClip()}
          >
            Scan clip
          </Button>
        </div>

        {scan ? (
          <ol data-testid="scan-results" className="text-ink-muted text-xs">
            {scan.map(({ t, lean, posture }) => (
              <li key={t}>
                t {t} s · lean {lean.toFixed(1)}° · axis {tiltText(posture.axis)} · trunk{' '}
                {tiltText(posture.trunk)} · head {tiltText(posture.head)} · shoulders{' '}
                {(posture.shoulders * 100).toFixed(1)} cm · feet {(posture.feet * 100).toFixed(1)}{' '}
                cm
              </li>
            ))}
          </ol>
        ) : null}

        {report ? (
          <>
            <Preview points={report.points} />
            <dl className="text-ink-muted grid max-w-[60ch] grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              <dt>height</dt>
              <dd>{report.height.toFixed(3)} m</dd>
              <dt>turn to face +z</dt>
              <dd>{report.turnDeg.toFixed(1)}°</dd>
              <PostureRows label="as posed" posture={report.posture.posed} />
              <dt>upright turn</dt>
              <dd>{report.upright.toFixed(1)}°</dd>
              <PostureRows label="as sampled" posture={report.posture.sampled} />
              <dt>upper arms from vertical</dt>
              <dd>
                {report.pose.armDeg.map((deg) => `${deg.toFixed(1)}°`).join(' / ')} (limit{' '}
                {MAX_ARM_DEG}°)
              </dd>
              <dt>wrist to hip joint, sideways</dt>
              <dd>
                {report.pose.handGap.map((gap) => `${(gap * 100).toFixed(1)} cm`).join(' / ')}
              </dd>
              <dt>nose tip</dt>
              <dd>
                {report.nose
                  ? `${(report.nose.ahead * 100).toFixed(1)} cm ahead of the skull centre, x ${report.nose.x.toFixed(3)}`
                  : 'n/a'}
              </dd>
              <dt>took</dt>
              <dd>{Math.round(report.ms)} ms</dd>
              {report.perSurface.map((surface) => (
                <SurfaceRow key={surface.name} {...surface} />
              ))}
              <dt>skipped</dt>
              <dd>{report.skipped.join(', ') || 'none'}</dd>
            </dl>
          </>
        ) : null}
      </section>
    </div>
  );
}

function PostureRows({ label, posture }: { label: string; posture: Posture }) {
  return (
    <>
      <dt>axis {label}</dt>
      <dd>
        {tiltText(posture.axis)} (limit {MAX_TILT_DEG}°)
      </dd>
      <dt>trunk / head {label}</dt>
      <dd>
        {tiltText(posture.trunk)} / {tiltText(posture.head)}
      </dd>
      <dt>shoulders / feet {label}</dt>
      <dd>
        {(posture.shoulders * 100).toFixed(1)} cm / {(posture.feet * 100).toFixed(1)} cm
      </dd>
    </>
  );
}

function SurfaceRow({ name, count }: { name: string; count: number }) {
  return (
    <>
      <dt>{name}</dt>
      <dd>{count}</dd>
    </>
  );
}

const PANEL = 220;
const PANEL_HEIGHT = 440;

/** Front (x, y) and side (z, y; facing right) views of the normalized points. */
function Preview({ points }: { points: Float32Array }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    const ratio = window.devicePixelRatio || 1;
    element.width = PANEL * 2 * ratio;
    element.height = PANEL_HEIGHT * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, PANEL * 2, PANEL_HEIGHT);
    context.fillStyle = getComputedStyle(element).color;
    const scale = PANEL_HEIGHT / 2 - 10;
    for (let i = 0; i < points.length; i += 3) {
      const y = PANEL_HEIGHT / 2 - points[i + 1]! * scale;
      context.fillRect(PANEL / 2 + points[i]! * scale - 0.6, y - 0.6, 1.2, 1.2);
      context.fillRect(PANEL * 1.5 + points[i + 2]! * scale - 0.6, y - 0.6, 1.2, 1.2);
    }
  }, [points]);
  return (
    <canvas
      ref={canvas}
      data-testid="preview"
      aria-label="Front and side view of the sampled points"
      className="border-hairline text-ink rounded-tile border"
      style={{ width: PANEL * 2, height: PANEL_HEIGHT }}
    />
  );
}
