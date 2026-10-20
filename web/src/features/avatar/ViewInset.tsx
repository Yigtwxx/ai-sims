'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { MathUtils, type PerspectiveCamera } from 'three';

/**
 * Centres the subject in the part of the canvas that is not covered by an
 * overlay panel (left or right), by shifting the projection (setViewOffset) instead of moving
 * the camera. Animating the inset to 0 glides the character to the middle of
 * the screen with no change in perspective.
 */
export function ViewInset({ left = 0, right = 0 }: { left?: number; right?: number }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  // Net inset: a left panel pushes the subject right, a right panel pushes it left.
  const current = useRef(left - right);
  const target = useRef(left - right);

  useEffect(() => {
    target.current = left - right;
  }, [left, right]);

  useEffect(
    () => () => {
      camera.clearViewOffset();
    },
    [camera],
  );

  useFrame((_, dt) => {
    current.current = MathUtils.damp(current.current, target.current, 6, Math.min(dt, 0.1));
    if (Math.abs(current.current - target.current) < 0.25) current.current = target.current;
    const shift = current.current / 2;
    if (shift === 0) {
      if (camera.view?.enabled) camera.clearViewOffset();
      return;
    }
    // Render a full-size frame whose centre sits in the middle of the visible area.
    camera.setViewOffset(size.width, size.height, -shift, 0, size.width, size.height);
  });

  return null;
}
