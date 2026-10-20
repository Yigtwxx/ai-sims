'use client';

import { CameraControls, CameraControlsImpl } from '@react-three/drei';
import { useEffect, useRef } from 'react';

import { getCameraPose, type CameraFocus } from './cameraFocus';

const { ACTION } = CameraControlsImpl;

/**
 * Camera that only dollies (wheel/pinch) and glides between framing presets.
 * Left-drag is reserved for the Turntable, which rotates the character.
 */
export function CameraRig({ focus, height }: { focus: CameraFocus; height?: number }) {
  const controls = useRef<CameraControlsImpl>(null);

  useEffect(() => {
    const pose = getCameraPose(focus, height);
    void controls.current?.setLookAt(...pose.position, ...pose.target, true);
  }, [focus, height]);

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
        wheel: ACTION.DOLLY,
      }}
      touches={{ one: ACTION.NONE, two: ACTION.TOUCH_DOLLY, three: ACTION.NONE }}
    />
  );
}
