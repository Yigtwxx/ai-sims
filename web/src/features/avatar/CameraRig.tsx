'use client';

import { CameraControls, CameraControlsImpl } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useRef, type RefObject } from 'react';
import { Vector3 } from 'three';

import { getCameraPose, zoomPose, type CameraFocus } from './cameraFocus';

const { ACTION } = CameraControlsImpl;

/** Zoom range over which the camera starts and fully follows the subject's head. */
const FOLLOW_FROM = 0.35;
const FOLLOW_TO = 0.9;
/** Re-aim only when the followed offset moved more than this (m). */
const FOLLOW_STEP = 0.0005;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Camera that only dollies (wheel/pinch) and glides between framing presets.
 * Left-drag is reserved for the Turntable, which rotates the character.
 * With `zoom` (0 full body .. 1 face) the owner drives the framing and the
 * built-in dolly is off, so zooming always heads for the face. `follow` is how
 * far the subject's head has moved from rest (world, m): close up, the camera
 * drifts with it like an operator would, so a swaying speaker stays framed;
 * at full body it holds still.
 */
export function CameraRig({
  focus,
  height,
  zoom,
  interactive = true,
  follow,
}: {
  focus: CameraFocus;
  height?: number;
  zoom?: number;
  interactive?: boolean;
  follow?: RefObject<Vector3 | null>;
}) {
  const controls = useRef<CameraControlsImpl>(null);
  const aimed = useRef(new Vector3());

  useEffect(() => {
    const pose = zoom === undefined ? getCameraPose(focus, height) : zoomPose(zoom, height);
    aimed.current.set(0, 0, 0);
    void controls.current?.setLookAt(...pose.position, ...pose.target, true);
  }, [focus, height, zoom]);

  useFrame(() => {
    const offset = follow?.current;
    if (zoom === undefined || !offset || !controls.current) return;
    const weight = smoothstep(FOLLOW_FROM, FOLLOW_TO, zoom);
    const x = offset.x * weight;
    const y = offset.y * weight;
    if (Math.hypot(x - aimed.current.x, y - aimed.current.y) < FOLLOW_STEP) return;
    aimed.current.set(x, y, 0);
    const pose = zoomPose(zoom, height);
    void controls.current.setLookAt(
      pose.position[0] + x,
      pose.position[1] + y,
      pose.position[2],
      pose.target[0] + x,
      pose.target[1] + y,
      pose.target[2],
      true,
    );
  });

  const dolly = interactive && zoom === undefined;

  return (
    <CameraControls
      ref={controls}
      makeDefault
      minDistance={0.6}
      maxDistance={6.5}
      smoothTime={0.45}
      draggingSmoothTime={0.15}
      mouseButtons={{
        left: ACTION.NONE,
        middle: ACTION.NONE,
        right: ACTION.NONE,
        wheel: dolly ? ACTION.DOLLY : ACTION.NONE,
      }}
      touches={{
        one: ACTION.NONE,
        two: dolly ? ACTION.TOUCH_DOLLY : ACTION.NONE,
        three: ACTION.NONE,
      }}
    />
  );
}
