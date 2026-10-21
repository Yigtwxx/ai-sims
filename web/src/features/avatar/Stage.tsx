'use client';

import { ContactShadows } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense, type ReactNode, type RefObject } from 'react';
import { AgXToneMapping, NoToneMapping, PCFShadowMap, SRGBColorSpace, type Vector3 } from 'three';

import { Backlight } from './Backlight';
import { CameraRig } from './CameraRig';
import { getCameraPose, zoomPose, type CameraFocus } from './cameraFocus';
import { Cyclorama } from './Cyclorama';
import { PostEffects, type RenderLook } from './PostEffects';
import { StudioLighting } from './StudioLighting';
import { Turntable } from './Turntable';
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
}

const BACKDROPS = {
  light: { background: '#f2f1ee', cyc: '#f4f3f0', glow: 0.55, shadow: 0.55 },
  dark: { background: '#121113', cyc: '#121114', glow: 0.015, shadow: 0.8 },
} as const;

/**
 * The photo studio: renderer settings, lighting, backdrop, camera and post.
 * Tone mapping happens in the post stack (AgX), so the renderer outputs linear.
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
}: StageProps) {
  const initial =
    zoom === undefined ? getCameraPose(focus, subjectHeight) : zoomPose(zoom, subjectHeight);
  const theme = BACKDROPS[backdrop];
  return (
    <Canvas
      className={[
        interactive ? 'cursor-grab touch-none active:cursor-grabbing' : 'pointer-events-none',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      shadows={{ type: PCFShadowMap }}
      dpr={[1, 2]}
      gl={{
        antialias: false,
        // Tone mapping runs in the post stack (AgX); without post use AgX directly.
        toneMapping: post ? NoToneMapping : AgXToneMapping,
        outputColorSpace: SRGBColorSpace,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true,
      }}
      camera={{ fov: 24, near: 0.05, far: 50, position: [...initial.position] }}
      onCreated={onCreated}
    >
      <color attach="background" args={[theme.background]} />
      <Suspense fallback={null}>
        {lighting ?? <StudioLighting />}
        <Cyclorama color={theme.cyc} glow={theme.glow} />
        {backdrop === 'dark' && <Backlight height={subjectHeight} />}
        <ContactShadows
          position={[0, 0.002, 0]}
          scale={3}
          blur={2.4}
          far={1.2}
          opacity={theme.shadow}
        />
        {scenery}
        <Turntable>{children}</Turntable>
        {post && <PostEffects look={look} />}
      </Suspense>
      <CameraRig
        focus={focus}
        height={subjectHeight}
        zoom={zoom}
        interactive={interactive}
        follow={follow}
      />
      <ViewInset left={insetLeft} right={insetRight} />
    </Canvas>
  );
}
