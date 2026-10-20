'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, type ReactNode } from 'react';
import type { Group } from 'three';

import { applyDrag, createTurntableState, release, stepTurntable } from './turntablePhysics';

/**
 * Rotates its children (not the camera) on horizontal drag, so studio lighting
 * stays fixed relative to the viewer like a real photo turntable.
 * Cursor and touch-action styling live on the Stage container (CSS).
 */
export function Turntable({ children }: { children: ReactNode }) {
  const group = useRef<Group>(null);
  const state = useRef(createTurntableState());
  const element = useThree((s) => s.gl.domElement);

  useEffect(() => {
    let lastX = 0;
    let pointerId: number | undefined;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      pointerId = e.pointerId;
      lastX = e.clientX;
      element.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      state.current = applyDrag(state.current, e.clientX - lastX);
      lastX = e.clientX;
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      pointerId = undefined;
      state.current = release(state.current);
    };

    element.addEventListener('pointerdown', onDown);
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', onUp);
    element.addEventListener('pointercancel', onUp);
    return () => {
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onUp);
    };
  }, [element]);

  useFrame((_, dt) => {
    state.current = stepTurntable(state.current, Math.min(dt, 0.1));
    if (group.current) group.current.rotation.y = state.current.angle;
  });

  return <group ref={group}>{children}</group>;
}
