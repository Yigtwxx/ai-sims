'use client';

import { ContactShadows } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense, type ReactNode } from 'react';
import { AgXToneMapping, NoToneMapping, PCFShadowMap, SRGBColorSpace } from 'three';

import { Backlight } from './Backlight';
import { CameraRig } from './CameraRig';
import { getCameraPose, type CameraFocus } from './cameraFocus';
import { Cyclorama } from './Cyclorama';
import { PostEffects, type RenderLook } from './PostEffects';
import { StudioLighting } from './StudioLighting';
import { Turntable } from './Turntable';
import { ViewInset } from './ViewInset';

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
  /** Static scene elements that must not turn with the character (e.g. backdrop type). */
  scenery?: ReactNode;
  /** Called once the WebGL context exists. */
  onCreated?: () => void;
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
  scenery,
  onCreated,
}: StageProps) {
  const initial = getCameraPose(focus, subjectHeight);
  const theme = BACKDROPS[backdrop];
  return (
    <Canvas
      className={['cursor-grab touch-none active:cursor-grabbing', className]
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
        <StudioLighting />
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
      <CameraRig focus={focus} height={subjectHeight} />
      <ViewInset left={insetLeft} />
    </Canvas>
  );
}
