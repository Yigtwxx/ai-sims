'use client';

import { useMemo } from 'react';
import { AdditiveBlending, CanvasTexture, SRGBColorSpace } from 'three';

/**
 * Soft warm halo behind the character, like key art lit from behind on a
 * premiere poster. A radial-gradient texture on a camera-facing plane; it is
 * additive and never writes depth, so it can't occlude anything.
 */
export function Backlight({
  color = '#ffe2b8',
  intensity = 0.16,
  height = 1.6,
}: {
  color?: string;
  intensity?: number;
  /** Subject height, used to centre the halo on the upper body. */
  height?: number;
}) {
  const texture = useMemo(() => {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d')!;
    const gradient = context.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    );
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.45, `${color}55`);
    gradient.addColorStop(1, `${color}00`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    return tex;
  }, [color]);

  return (
    <mesh position={[0, height * 0.62, -1.6]} renderOrder={-1}>
      <planeGeometry args={[height * 2.6, height * 2.2]} />
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={intensity}
        depthWrite={false}
        blending={AdditiveBlending}
        toneMapped={false}
      />
    </mesh>
  );
}
