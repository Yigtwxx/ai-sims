'use client';

import { useFrame } from '@react-three/fiber';
import {
  memo,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Vector3, type Camera, type Object3D } from 'three';

import type { SpeechPlayer } from '@/features/lipsync/speechPlayer';
import type { MhManifest } from '@/lib/assets/manifest';
import type { CharacterConfig } from '@/lib/character/schema';

import { isCloseUp, type CameraFocus } from '../cameraFocus';
import type { QualityPreference } from '../quality';
import { Stage } from '../Stage';
import { CharacterLife, type FaceLayers, type LifeInput } from './characterLife';
import { loadFaceClip } from './faceClips';
import { keepFacing } from './facing';
import type { LifeMode } from './idle';
import { MhCharacter, type MhCharacterHandle } from './MhCharacter';
import { MhLighting } from './MhLighting';
import { resolveCharacter, type ResolvedCharacter } from './resolve';
import { StageSwap } from './swap';

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
  /** Talk mode: a reply is playing; lip-sync keeps the display frame rate. */
  speaking?: boolean;
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
  /**
   * Fired with false when the stage starts catching up with `config` (a new
   * face or body assembles off screen while the old one stays, or skin, hair or
   * clothes reload), and with true once the character on screen is the one it
   * asks for, settled and drawn. The creator captures its thumbnail on true.
   */
  onCaughtUp?: (caughtUp: boolean) => void;
  /**
   * Dev benches only (product pages leave it unset): hands over the settled
   * character with every onSettled, to probe its meshes or hold its pose
   * (`handle.motion.hold`). Changes nothing about how the stage renders.
   */
  onCharacter?: (handle: MhCharacterHandle) => void;
  /** Render tier (default auto: starts high, steps down while frames drop). */
  quality?: QualityPreference;
  /** Studio backdrop: the paper-toned photo studio (default) or the dark stage. */
  backdrop?: 'light' | 'dark';
  className?: string;
}

const WHEEL_STEP = 0.0016;
const headWorld = new Vector3();
const eyeWorld = new Vector3();
const EYE_BONES = ['FACIAL_L_Eye', 'FACIAL_R_Eye'] as const;
const PINCH_STEP = 0.004;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
/** One element for every render: a new one would re-render the whole studio set. */
const STUDIO_LIGHTING = <MhLighting rig="studio" />;

/** A character is rebuilt (new GLBs) only when its body or head changes. */
export const characterKey = (resolved: ResolvedCharacter) =>
  `${resolved.bodyUrl}|${resolved.headUrl}`;

/**
 * Memoised: the creator re-renders on every slider step and keystroke; the
 * stage only needs to when its own props change.
 */
export const MhStage = memo(function MhStage({
  config,
  manifest,
  mode,
  focus = 'body',
  zoom,
  onZoomChange,
  speech = null,
  thinking = false,
  speaking = false,
  insetLeft = 0,
  insetRight = 0,
  onReady,
  onSettled,
  onCaughtUp,
  onCharacter,
  className,
  quality,
  backdrop = 'light',
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

  // A face or body change assembles the new character off screen; the one on
  // screen stays until the new one has its skin, hair and clothes, then they
  // swap in one frame (no empty stage, no bare or bald in-between).
  const [shown, setShown] = useState(resolved);
  const swapping = !!resolved && !!shown && characterKey(resolved) !== characterKey(shown);
  if (!swapping && resolved !== shown) setShown(resolved);
  const latestResolved = useRef(resolved);
  useLayoutEffect(() => {
    latestResolved.current = resolved;
  }, [resolved]);
  // Both characters by instance: a late settle from an incoming one that was
  // unmounted (faces browsed back and forth) must not promote its remount.
  const swap = useRef(new StageSwap<MhCharacterHandle>());
  const latestOnCaughtUp = useRef(onCaughtUp);
  useLayoutEffect(() => {
    latestOnCaughtUp.current = onCaughtUp;
  }, [onCaughtUp]);
  const caughtUp = useRef<boolean | null>(null);
  // Behind is reported at once; caught up two frames later, once it has been drawn.
  const reportCaughtUp = useCallback(() => {
    const tell = (value: boolean) => {
      if (caughtUp.current === value) return;
      caughtUp.current = value;
      latestOnCaughtUp.current?.(value);
    };
    if (!swap.current.caughtUp) tell(false);
    else if (caughtUp.current !== true) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (swap.current.caughtUp) tell(true);
        }),
      );
    }
  }, []);
  const requestedKey = resolved ? characterKey(resolved) : null;
  useLayoutEffect(() => {
    swap.current.request(requestedKey, swapping);
    reportCaughtUp();
  }, [requestedKey, swapping, reportCaughtUp]);
  const attachIncoming = useCallback((handle: MhCharacterHandle | null) => {
    swap.current.setIncoming(handle);
  }, []);
  const attachOnScreen = useCallback(
    (handle: MhCharacterHandle | null) => {
      swap.current.setOnScreen(handle);
      reportCaughtUp();
    },
    [reportCaughtUp],
  );

  // One life per character: the incoming one is posed while it assembles.
  // Life reads the latest mode and speech without re-creating the frame callback.
  const lives = useRef(new WeakMap<MhCharacterHandle, CharacterLife>());
  const faceLayers = useRef<FaceLayers>({});
  const lifeOf = useCallback((handle: MhCharacterHandle) => {
    let life = lives.current.get(handle);
    if (!life) {
      life = new CharacterLife();
      lives.current.set(handle, life);
    }
    life.faceLayers = faceLayers.current;
    return life;
  }, []);
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
  // The creator frames close-ups: an idle that turns the body away is turned back.
  const facing = mode === 'creator';
  // The eye centre, for the close-up framings (brows, mouth) to aim at.
  const closeUp = isCloseUp(focus);
  const anchor = useRef<Vector3 | null>(null);
  const eyes = useRef<{ handle: MhCharacterHandle; bones: Object3D[] } | null>(null);
  const onIncomingFrame = useCallback(
    (handle: MhCharacterHandle, delta: number, camera: Camera) => {
      lifeOf(handle).step(handle, frozen ? 0 : delta, {
        ...input.current,
        viewer: camera.position,
      });
      if (facing) faceViewer(handle, delta);
    },
    [lifeOf, frozen, facing],
  );
  const onFrame = useCallback(
    (handle: MhCharacterHandle, delta: number, camera: Camera) => {
      lifeOf(handle).step(handle, frozen ? 0 : delta, {
        ...input.current,
        viewer: camera.position,
      });
      if (facing) faceViewer(handle, delta);
      if (closeUp) {
        if (eyes.current?.handle !== handle) {
          const bones = EYE_BONES.flatMap((name) => {
            const bone = handle.body.root.getObjectByName(name);
            return bone ? [bone] : [];
          });
          eyes.current = { handle, bones };
        }
        const { bones } = eyes.current;
        if (bones.length > 0) {
          const centre = (anchor.current ??= new Vector3()).set(0, 0, 0);
          for (const bone of bones) centre.add(bone.getWorldPosition(eyeWorld));
          centre.divideScalar(bones.length);
        }
      }
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
    [lifeOf, frozen, facing, closeUp],
  );
  const latestOnSettled = useRef(onSettled);
  const latestOnCharacter = useRef(onCharacter);
  useLayoutEffect(() => {
    latestOnSettled.current = onSettled;
    latestOnCharacter.current = onCharacter;
  }, [onSettled, onCharacter]);
  // Two frames later the settled character has been drawn, not just bound.
  const handleSettled = useCallback((handle: MhCharacterHandle) => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        latestOnSettled.current?.();
        latestOnCharacter.current?.(handle);
      }),
    );
  }, []);
  const slotSettled = useCallback(
    (handle: MhCharacterHandle, key: string, incoming: boolean) => {
      swap.current.settle(handle, key);
      if (incoming) {
        // Only the incoming instance mounted now, and only while its character
        // is still the one asked for, replaces the one on screen.
        const next = latestResolved.current;
        if (!next || !swap.current.canPromote(handle, key)) return;
        setShown(next);
      }
      handleSettled(handle);
      reportCaughtUp();
    },
    [handleSettled, reportCaughtUp],
  );
  const slotUnsettled = useCallback(
    (handle: MhCharacterHandle) => {
      swap.current.unsettle(handle);
      reportCaughtUp();
    },
    [reportCaughtUp],
  );

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
      if (live) faceLayers.current = { idle, smile };
    });
    return () => {
      live = false;
    };
  }, [idleFace, smileFace]);

  const slots = [
    ...(swapping ? [{ resolved: shown!, incoming: false }] : []),
    ...(resolved ? [{ resolved, incoming: swapping }] : []),
  ];

  return (
    <div ref={container} className={className}>
      <Stage
        focus={focus}
        zoom={effectiveZoom}
        insetLeft={insetLeft}
        insetRight={insetRight}
        backdrop={backdrop}
        lighting={STUDIO_LIGHTING}
        // Thumbnails show the item alone, without the plinth.
        platform={mode !== 'thumbnail'}
        // Frame the character on screen; an incoming one is still hidden.
        subjectHeight={(shown ?? resolved)?.height}
        interactive={mode === 'creator' || talk}
        follow={talk ? follow : undefined}
        anchor={closeUp ? anchor : undefined}
        // Every new creator framing starts with the character facing the viewer.
        turnHome={mode === 'creator' ? focus : undefined}
        quality={quality}
        lively={talk && speaking}
        className="size-full"
      >
        {slots.map(({ resolved: character, incoming }) => {
          const key = characterKey(character);
          return (
            // Same key and position whether incoming or shown, so the swap
            // keeps the assembled character instead of rebuilding it.
            <group key={key} visible={!incoming}>
              <Suspense fallback={null}>
                <MhCharacter
                  ref={incoming ? attachIncoming : attachOnScreen}
                  bodyUrl={character.bodyUrl}
                  headUrl={character.headUrl}
                  sliders={character.sliders}
                  skin={character.skin}
                  makeup={character.makeup}
                  skinTone={character.skinTone}
                  iris={character.iris}
                  irisTint={character.irisTint}
                  // A still takes the same pose every time: the first clip, not a random one.
                  idleClips={frozen ? character.idleClips.slice(0, 1) : character.idleClips}
                  idleLayer={character.idleLayer}
                  // Gestures and listening only where the character converses.
                  talkClips={talk ? character.talkClips : undefined}
                  listenClips={talk ? character.listenClips : undefined}
                  grooms={character.grooms}
                  outfits={character.outfits}
                  underwearTop={character.underwearTop}
                  onFrame={incoming ? onIncomingFrame : onFrame}
                  prewarm={incoming}
                  onSettled={(handle) => slotSettled(handle, key, incoming)}
                  onUnsettled={slotUnsettled}
                />
                {!incoming && <FirstFrame onReady={onReady} />}
              </Suspense>
            </group>
          );
        })}
      </Stage>
    </div>
  );
});

/** Turns the character back toward the viewer when its idle has turned the chest away. */
function faceViewer(handle: MhCharacterHandle, delta: number) {
  const { bones } = handle.body;
  keepFacing(bones.get('root'), bones.get('clavicle_l'), bones.get('clavicle_r'), delta);
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
