'use client';

import { ContactShadows } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense, type ReactNode } from 'react';
import { AgXToneMapping, NoToneMapping, PCFShadowMap, SRGBColorSpace } from 'three';

import { CameraRig } from './CameraRig';
import { getCameraPose, type CameraFocus } from './cameraFocus';
import { Cyclorama } from './Cyclorama';
import { PostEffects, type RenderLook } from './PostEffects';
import { StudioLighting } from './StudioLighting';
import { Turntable } from './Turntable';

interface StageProps {
  children: ReactNode;
  focus?: CameraFocus;
  className?: string;
  /** Disable the post-processing stack (for debugging and A/B checks). */
  post?: boolean;
  look?: RenderLook;
  /** Measured character height (metres) used to scale camera framing. */
  subjectHeight?: number;
}

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
}: StageProps) {
  const initial = getCameraPose(focus, subjectHeight);
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
    >
      <color attach="background" args={['#f2f1ee']} />
      <Suspense fallback={null}>
        <StudioLighting />
        <Cyclorama />
        <ContactShadows position={[0, 0.002, 0]} scale={3} blur={2.4} far={1.2} opacity={0.55} />
        <Turntable>{children}</Turntable>
        {post && <PostEffects look={look} />}
      </Suspense>
      <CameraRig focus={focus} height={subjectHeight} />
    </Canvas>
  );
}
