'use client';

import { CameraControls, CameraControlsImpl } from '@react-three/drei';
import { useEffect, useRef } from 'react';

import { getCameraPose, zoomPose, type CameraFocus } from './cameraFocus';

const { ACTION } = CameraControlsImpl;

/**
 * Camera that only dollies (wheel/pinch) and glides between framing presets.
 * Left-drag is reserved for the Turntable, which rotates the character.
 * With `zoom` (0 full body .. 1 face) the owner drives the framing and the
 * built-in dolly is off, so zooming always heads for the face.
 */
export function CameraRig({
  focus,
  height,
  zoom,
  interactive = true,
}: {
  focus: CameraFocus;
  height?: number;
  zoom?: number;
  interactive?: boolean;
}) {
  const controls = useRef<CameraControlsImpl>(null);

  useEffect(() => {
    const pose = zoom === undefined ? getCameraPose(focus, height) : zoomPose(zoom, height);
    void controls.current?.setLookAt(...pose.position, ...pose.target, true);
  }, [focus, height, zoom]);

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
