'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, type ReactNode } from 'react';
import type { Group } from 'three';

import {
  applyDrag,
  createTurntableState,
  nearestFront,
  release,
  stepHome,
  stepTurntable,
} from './turntablePhysics';

/**
 * Rotates its children (not the camera) on horizontal drag, so studio lighting
 * stays fixed relative to the viewer like a real photo turntable.
 * Cursor and touch-action styling live on the Stage container (CSS).
 * Whenever `home` changes (a new framing), a character the viewer turned
 * away glides back to face them; a drag takes over at once.
 */
export function Turntable({ children, home }: { children: ReactNode; home?: unknown }) {
  const group = useRef<Group>(null);
  const state = useRef(createTurntableState());
  const homing = useRef<number | null>(null);
  const element = useThree((s) => s.gl.domElement);
  const lastHome = useRef(home);

  useEffect(() => {
    if (Object.is(home, lastHome.current)) return;
    lastHome.current = home;
    homing.current = nearestFront(state.current.angle);
  }, [home]);

  useEffect(() => {
    let lastX = 0;
    let pointerId: number | undefined;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      pointerId = e.pointerId;
      lastX = e.clientX;
      homing.current = null;
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
    const step = Math.min(dt, 0.1);
    const target = homing.current;
    if (target === null) state.current = stepTurntable(state.current, step);
    else {
      state.current = stepHome(state.current, target, step);
      if (state.current.angle === target) homing.current = null;
    }
    if (group.current) group.current.rotation.y = state.current.angle;
  });

  return <group ref={group}>{children}</group>;
}
