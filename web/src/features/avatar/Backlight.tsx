'use client';

import { useMemo } from 'react';
import { AdditiveBlending, CanvasTexture, SRGBColorSpace } from 'three';

/** Halo plane size and placement, as multiples of the subject height. */
const CENTRE_Y = 0.62;
const PLANE_WIDTH = 2.6;
const PLANE_HEIGHT = 2.2;
const PLANE_Z = -1.6;

/**
 * Where the floor (y = 0) cuts the halo plane, as a fraction of the texture
 * height from the top. The cyclorama floor runs flat up to PLANE_Z, so it hides
 * everything below this row and used to leave a hard horizontal edge there.
 */
const FLOOR_ROW = (CENTRE_Y + PLANE_HEIGHT / 2) / PLANE_HEIGHT;

/**
 * Soft warm halo behind the character, like key art lit from behind on a
 * premiere poster. A radial-gradient texture on a camera-facing plane; it is
 * additive and never writes depth, so it can't occlude anything. Its lower
 * part fades out before it reaches the floor line, so the lit back wall rolls
 * into the dark floor without a seam.
 */
export function Backlight({
  color = '#ece4d8',
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
    // Keep only the part above the floor, feathered (eased) down to nothing at it.
    const fade = context.createLinearGradient(0, 0, 0, size);
    fade.addColorStop(0, '#000');
    fade.addColorStop(FLOOR_ROW * 0.6, '#000');
    fade.addColorStop(FLOOR_ROW * 0.8, 'rgba(0,0,0,0.6)');
    fade.addColorStop(FLOOR_ROW * 0.92, 'rgba(0,0,0,0.18)');
    fade.addColorStop(FLOOR_ROW, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    context.globalCompositeOperation = 'destination-in';
    context.fillStyle = fade;
    context.fillRect(0, 0, size, size);
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    return tex;
  }, [color]);

  return (
    <mesh position={[0, height * CENTRE_Y, PLANE_Z]} renderOrder={-1}>
      <planeGeometry args={[height * PLANE_WIDTH, height * PLANE_HEIGHT]} />
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
