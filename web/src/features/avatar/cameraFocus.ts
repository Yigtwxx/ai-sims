/**
 * Camera framing presets per creator category. Positions are in metres for a
 * character standing at the origin facing +Z (~1.85 m tall, eyes at ~1.76 m).
 */

export type CameraFocus = 'body' | 'face' | 'torso' | 'legs' | 'feet';

export interface CameraPose {
  position: readonly [number, number, number];
  target: readonly [number, number, number];
}

export const CAMERA_POSES: Record<CameraFocus, CameraPose> = {
  body: { position: [0, 1.05, 5.4], target: [0, 0.92, 0] },
  face: { position: [0.06, 1.75, 1.15], target: [0, 1.72, 0.06] },
  torso: { position: [0, 1.42, 2.6], target: [0, 1.36, 0] },
  legs: { position: [0, 0.75, 3.0], target: [0, 0.6, 0] },
  feet: { position: [0.1, 0.55, 1.7], target: [0, 0.1, 0] },
};
