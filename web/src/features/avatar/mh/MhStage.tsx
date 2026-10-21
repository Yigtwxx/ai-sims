'use client';

import { useFrame, useThree } from '@react-three/fiber';
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Vector3, type Camera } from 'three';

import type { SpeechPlayer } from '@/features/lipsync/speechPlayer';
import type { MhManifest } from '@/lib/assets/manifest';
import type { CharacterConfig } from '@/lib/character/schema';

import type { CameraFocus } from '../cameraFocus';
import type { QualityPreference } from '../quality';
import { Stage } from '../Stage';
import { CharacterLife, type LifeInput } from './characterLife';
import { loadFaceClip } from './faceClips';
import type { LifeMode } from './idle';
import { MhCharacter, type MhCharacterHandle } from './MhCharacter';
import { releaseKtx2Loader } from './loaders';
import { MhLighting } from './MhLighting';
import { resolveCharacter } from './resolve';

/**
 * Public interface of the photoreal MetaHuman stage. Pages (creator, talk, landing
 * hero, thumbnails) render this component only; everything inside (loading,
 * assembly, materials, life and lip-sync) belongs to the avatar feature.
 */
export interface MhStageProps {
  config: CharacterConfig;
  manifest: MhManifest;
  /**
   * creator: idle life + reactions to edits, drag to turn.
   * talk: full-body framing by default, zoom and turn, lip-sync from `speech`.
   * hero: landing hero, slow presentation, no interaction.
   * thumbnail: still render for capturing item and character thumbnails.
   */
  mode: 'creator' | 'talk' | 'hero' | 'thumbnail';
  /** Camera framing; creator categories map to body/face/torso/legs/feet. */
  focus?: CameraFocus;
  /**
   * Talk mode: zoom from full body (0) to face close-up (1). Leave undefined to
   * let the stage own it (wheel and pinch); pass it with `onZoomChange` to
   * drive it from page controls as well.
   */
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  /** Talk mode: drives visemes, jaw and speaking gestures while it plays. */
  speech?: SpeechPlayer | null;
  /** Talk mode: the model is composing a reply (thinking gaze and gestures). */
  thinking?: boolean;
  /** Pixels covered by a panel on the left so the character centres in the rest. */
  insetLeft?: number;
  /** Pixels covered by a panel on the right (talk mode chat). */
  insetRight?: number;
  /** Fired once the character is assembled and the first frame is on screen. */
  onReady?: () => void;
  /**
   * Fired once skin, eyes and grooms are on and drawn (after onReady, and again
   * after every change that reloads them). Thumbnails capture on this.
   */
  onSettled?: () => void;
  /** Render tier (default auto: starts high, steps down while frames drop). */
  quality?: QualityPreference;
  className?: string;
}

const WHEEL_STEP = 0.0016;
const headWorld = new Vector3();
const PINCH_STEP = 0.004;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function MhStage({
  config,
  manifest,
  mode,
  focus = 'body',
  zoom,
  onZoomChange,
  speech = null,
  thinking = false,
  insetLeft = 0,
  insetRight = 0,
  onReady,
  onSettled,
  className,
  quality,
}: MhStageProps) {
  const resolved = useMemo(() => resolveCharacter(config, manifest), [config, manifest]);
  const talk = mode === 'talk';
  const [ownZoom, setOwnZoom] = useState(0);
  const effectiveZoom = talk ? (zoom ?? ownZoom) : undefined;
  const zoomRef = useRef(effectiveZoom ?? 0);
  useLayoutEffect(() => {
    zoomRef.current = effectiveZoom ?? 0;
  }, [effectiveZoom]);

  const changeZoom = useCallback(
    (delta: number) => {
      const next = clamp01(zoomRef.current + delta);
      if (next === zoomRef.current) return;
      setOwnZoom(next);
      onZoomChange?.(next);
    },
    [onZoomChange],
  );
  const container = usePinchAndWheel(talk ? changeZoom : undefined);

  // Life reads the latest mode and speech without re-creating the frame callback.
  const life = useMemo(() => new CharacterLife(), []);
  const lifeMode: LifeMode = talk ? (thinking ? 'thinking' : 'listening') : 'idle';
  const input = useRef<LifeInput>({ mode: lifeMode, speech });
  useLayoutEffect(() => {
    input.current = { mode: lifeMode, speech };
  }, [lifeMode, speech]);
  // How far the head has moved from where it stood when the character appeared:
  // the talk close-up follows it so a swaying speaker stays framed.
  const follow = useRef<Vector3 | null>(null);
  const followRest = useRef<{ handle: MhCharacterHandle; head: Vector3 } | null>(null);
  // Thumbnails are stills: life holds its first pose (no blink, no glance).
  const frozen = mode === 'thumbnail';
  const onFrame = useCallback(
    (handle: MhCharacterHandle, delta: number, camera: Camera) => {
      life.step(handle, frozen ? 0 : delta, { ...input.current, viewer: camera.position });
      const head = handle.body.bones.get('head');
      if (!head) return;
      head.getWorldPosition(headWorld);
      if (followRest.current?.handle !== handle) {
        followRest.current = { handle, head: headWorld.clone() };
      }
      follow.current = (follow.current ?? new Vector3())
        .copy(headWorld)
        .sub(followRest.current.head);
    },
    [life, frozen],
  );
  const latestOnSettled = useRef(onSettled);
  useLayoutEffect(() => {
    latestOnSettled.current = onSettled;
  }, [onSettled]);
  // Two frames later the settled character has been drawn, not just bound.
  const handleSettled = useCallback(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => latestOnSettled.current?.()));
  }, []);

  const idleFace = resolved?.faceClips.idle ?? null;
  const smileFace = resolved?.faceClips.smile ?? null;
  useEffect(() => {
    let live = true;
    const load = (url: string | null) =>
      url
        ? loadFaceClip(url).catch((error: unknown) => {
            console.warn('[mh] face clip failed to load', url, error);
            return undefined;
          })
        : Promise.resolve(undefined);
    void Promise.all([load(idleFace), load(smileFace)]).then(([idle, smile]) => {
      if (live) life.faceLayers = { idle, smile };
    });
    return () => {
      live = false;
    };
  }, [life, idleFace, smileFace]);

  return (
    <div ref={container} className={className}>
      <Stage
        focus={focus}
        zoom={effectiveZoom}
        insetLeft={insetLeft}
        insetRight={insetRight}
        backdrop="dark"
        lighting={<MhLighting rig="studio" />}
        subjectHeight={resolved?.height}
        interactive={mode === 'creator' || talk}
        follow={talk ? follow : undefined}
        quality={quality}
        className="size-full"
      >
        <Suspense fallback={null}>
          {resolved && (
            <>
              <MhCharacter
                key={`${resolved.bodyUrl}|${resolved.headUrl}`}
                bodyUrl={resolved.bodyUrl}
                headUrl={resolved.headUrl}
                sliders={resolved.sliders}
                skin={resolved.skin}
                makeup={resolved.makeup}
                iris={resolved.iris}
                idleClips={resolved.idleClips}
                idleLayer={resolved.idleLayer}
                grooms={resolved.grooms}
                onFrame={onFrame}
                onSettled={handleSettled}
              />
              <FirstFrame onReady={onReady} />
              <ReleaseTranscoder />
            </>
          )}
        </Suspense>
      </Stage>
    </div>
  );
}

/** Frees the renderer's KTX2 transcoder workers when the stage unmounts. */
function ReleaseTranscoder() {
  const gl = useThree((state) => state.gl);
  useEffect(() => () => releaseKtx2Loader(gl), [gl]);
  return null;
}

/** Calls `onReady` on the first rendered frame after the character mounted. */
function FirstFrame({ onReady }: { onReady?: () => void }) {
  const fired = useRef(false);
  useFrame(() => {
    if (fired.current) return;
    fired.current = true;
    onReady?.();
  });
  return null;
}

/**
 * Wheel and two-finger pinch on the stage container, reported as zoom deltas
 * (+ zooms in). Disabled when `onZoom` is undefined.
 */
function usePinchAndWheel(onZoom: ((delta: number) => void) | undefined) {
  const ref = useRef<HTMLDivElement>(null);
  const handler = useRef(onZoom);
  useLayoutEffect(() => {
    handler.current = onZoom;
  }, [onZoom]);
  const enabled = onZoom !== undefined;

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    const touches = new Map<number, { x: number; y: number }>();
    let spread = 0;
    const distance = () => {
      const [a, b] = [...touches.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      handler.current?.(-event.deltaY * WHEEL_STEP);
    };
    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      spread = distance();
    };
    const onMove = (event: PointerEvent) => {
      if (!touches.has(event.pointerId)) return;
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.size !== 2) return;
      const next = distance();
      if (spread > 0) handler.current?.((next - spread) * PINCH_STEP);
      spread = next;
    };
    const onUp = (event: PointerEvent) => {
      touches.delete(event.pointerId);
      spread = distance();
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('pointerdown', onDown);
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', onUp);
    element.addEventListener('pointercancel', onUp);
    return () => {
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onUp);
    };
  }, [enabled]);

  return ref;
}
