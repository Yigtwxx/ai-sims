'use client';

import { PerformanceMonitor } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { memo, Suspense, useEffect, useState, type ReactNode, type RefObject } from 'react';
import {
  NeutralToneMapping,
  NoToneMapping,
  PCFShadowMap,
  SRGBColorSpace,
  type Vector3,
} from 'three';

import { Backlight } from './Backlight';
import { CameraRig } from './CameraRig';
import { focusHeading, getCameraPose, zoomPose, type CameraFocus } from './cameraFocus';
import { Cyclorama } from './Cyclorama';
import { Platform, PLATFORM_HEIGHT } from './Platform';
import { PostEffects, type RenderLook } from './PostEffects';
import {
  IDLE_AFTER_MS,
  QUALITY,
  QualityContext,
  autoStep,
  frameCap,
  type QualityPreference,
  type RenderQuality,
} from './quality';
import { StudioLighting } from './StudioLighting';
import { Turntable } from './Turntable';
import { useInputIdle } from './useInputIdle';
import { ViewInset } from './ViewInset';
import { applySmoothShadowFilter } from './shadowFilter';

// Before the first material compiles (see ./shadowFilter.ts).
applySmoothShadowFilter();

interface StageProps {
  children: ReactNode;
  focus?: CameraFocus;
  className?: string;
  /** Disable the post-processing stack (for debugging and A/B checks). */
  post?: boolean;
  look?: RenderLook;
  /** Measured character height (metres) used to scale camera framing. */
  subjectHeight?: number;
  /** 'light' photo studio or 'dark' premiere stage with a warm backlight. */
  backdrop?: 'light' | 'dark';
  /** Pixels covered by an overlay panel on the left; the subject centres in the rest. */
  insetLeft?: number;
  /** Pixels covered by an overlay panel on the right (talk chat). */
  insetRight?: number;
  /** Owner-driven framing from full body (0) to face (1); replaces `focus`. */
  zoom?: number;
  /** False for presentation renders: no turning, no dolly. */
  interactive?: boolean;
  /** Static scene elements that must not turn with the character (e.g. backdrop type). */
  scenery?: ReactNode;
  /** Replaces the default studio lights (e.g. the MetaHuman Creator rig). */
  lighting?: ReactNode;
  /** Called once the WebGL context exists. */
  onCreated?: () => void;
  /** How far the subject's head moved from rest; close-up framing follows it. */
  follow?: RefObject<Vector3 | null>;
  /** The subject's eye centre (world); the brows and mouth framings aim at it. */
  anchor?: RefObject<Vector3 | null>;
  /** A tattoo spot for the tattoo framings to follow (see CameraRig). */
  spot?: RefObject<{ point: Vector3; normal: Vector3 } | null>;
  /** Render tier; `auto` starts high and steps down while frames drop. */
  quality?: QualityPreference;
  /**
   * Keep the display rate without any input (the character is speaking). The
   * stage otherwise drops to IDLE_FPS a few seconds after the last input.
   */
  lively?: boolean;
  /** When this changes, a turned subject glides back to face the viewer. */
  turnHome?: unknown;
  /** Stand the subject on a low plinth (the floor drops to meet its base). */
  platform?: boolean;
}

const BACKDROPS = {
  // Paper-toned: the studio continues the site's paper ground (DESIGN.md).
  light: { background: '#e6e3dc', cyc: '#eceae4', glow: 0.55, platform: '#d4cfc5' },
  dark: { background: '#121113', cyc: '#121114', glow: 0.015, platform: '#2a2826' },
} as const;

/**
 * The photo studio: renderer settings, lighting, backdrop, camera and post.
 * Tone mapping happens in the post stack (Neutral), so the renderer outputs linear.
 */
export function Stage({
  children,
  focus = 'body',
  className,
  post = true,
  look = 'realistic',
  subjectHeight,
  backdrop = 'light',
  insetLeft = 0,
  insetRight = 0,
  zoom,
  interactive = true,
  scenery,
  lighting,
  onCreated,
  follow,
  anchor,
  spot,
  quality = 'auto',
  lively = false,
  turnHome,
  platform = false,
}: StageProps) {
  const [autoTier, setAutoTier] = useState<RenderQuality>('high');
  const tier = quality === 'auto' ? autoTier : quality;
  const settings = QUALITY[tier];
  const idle = useInputIdle(IDLE_AFTER_MS) && !lively;
  const cap = frameCap(settings.maxFps, idle);
  const initial =
    zoom === undefined ? getCameraPose(focus, subjectHeight) : zoomPose(zoom, subjectHeight);
  return (
    <Canvas
      className={[
        interactive ? 'cursor-grab touch-none active:cursor-grabbing' : 'pointer-events-none',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      shadows={{ type: PCFShadowMap }}
      dpr={settings.dpr}
      frameloop={cap ? 'demand' : 'always'}
      gl={{
        antialias: false,
        // Tone mapping runs in the post stack; without post the renderer applies it.
        toneMapping: post ? NoToneMapping : NeutralToneMapping,
        outputColorSpace: SRGBColorSpace,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true,
      }}
      camera={{ fov: 24, near: 0.05, far: 50, position: [...initial.position] }}
      onCreated={onCreated}
    >
      {/* Judged only at the full rate: a capped stage would read as a slow one. */}
      {quality === 'auto' && !cap && (
        <PerformanceMonitor
          onDecline={() => setAutoTier((current) => autoStep(current, 'down'))}
          onIncline={() => setAutoTier((current) => autoStep(current, 'up'))}
          // Settle on the current tier rather than flip between two forever.
          flipflops={4}
        />
      )}
      {cap && <FrameCap fps={cap} />}
      <QualityContext.Provider value={settings}>
        <Suspense fallback={null}>
          <StudioSet
            backdrop={backdrop}
            lighting={lighting}
            scenery={scenery}
            subjectHeight={subjectHeight}
            platform={platform}
          />
          <Turntable home={turnHome} heading={focusHeading(focus)}>
            {children}
          </Turntable>
          {post && <PostEffects look={look} ao={settings.ao} />}
        </Suspense>
      </QualityContext.Provider>
      <CameraRig
        focus={focus}
        height={subjectHeight}
        zoom={zoom}
        interactive={interactive}
        follow={follow}
        anchor={anchor}
        spot={spot}
      />
      <ViewInset left={insetLeft} right={insetRight} />
    </Canvas>
  );
}

/**
 * Backdrop and lights. Memoised: a character edit re-renders the stage every
 * slider step, and the studio itself never depends on the character. The
 * floor needs no contact-shadow pass: the key light's shadow and the AO ground
 * the feet, and drei's ContactShadows re-rendered the whole skinned character
 * every frame (a quarter of the main thread) and left blotches on the floor.
 */
const StudioSet = memo(function StudioSet({
  backdrop,
  lighting,
  scenery,
  subjectHeight,
  platform,
}: {
  backdrop: 'light' | 'dark';
  lighting?: ReactNode;
  scenery?: ReactNode;
  subjectHeight?: number;
  platform: boolean;
}) {
  const theme = BACKDROPS[backdrop];
  return (
    <>
      <color attach="background" args={[theme.background]} />
      {lighting ?? <StudioLighting />}
      {/* The feet stay at y = 0; with a plinth, the floor drops to its base. */}
      <group position-y={platform ? -PLATFORM_HEIGHT : 0}>
        <Cyclorama color={theme.cyc} glow={theme.glow} />
        {backdrop === 'dark' && <Backlight height={subjectHeight} />}
      </group>
      {platform && <Platform color={theme.platform} />}
      {scenery}
    </>
  );
});

/** Renders on demand at most `fps` times a second (canvas frameloop 'demand'). */
function FrameCap({ fps }: { fps: number }) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    let frame = 0;
    let last = 0;
    const interval = 1000 / fps;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      // A couple of ms of slack so a 60 Hz display lands on every second frame.
      if (now - last >= interval - 2) {
        last = now;
        invalidate();
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [fps, invalidate]);
  return null;
}
