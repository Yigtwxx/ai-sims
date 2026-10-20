/**
 * Camera framing presets per creator category, authored for a reference
 * character standing at the origin facing +Z and scaled to the actual
 * character height so a 1.5 m anime avatar and a 1.85 m human frame alike.
 */

export type CameraFocus = 'body' | 'face' | 'torso' | 'legs' | 'feet' | 'premiere';

type Vec3 = readonly [number, number, number];

export interface CameraPose {
  position: Vec3;
  target: Vec3;
}

/** Height (metres) the presets below were authored for. */
export const REFERENCE_HEIGHT = 1.85;

const REFERENCE_POSES: Record<CameraFocus, CameraPose> = {
  body: { position: [0, 1.02, 5.9], target: [0, 0.9, 0] },
  face: { position: [0.05, 1.74, 1.6], target: [0, 1.68, 0.05] },
  torso: { position: [0, 1.42, 2.6], target: [0, 1.36, 0] },
  legs: { position: [0, 0.75, 3.0], target: [0, 0.6, 0] },
  feet: { position: [0.1, 0.55, 1.7], target: [0, 0.1, 0] },
  // Smaller and higher in frame, leaving the lower third for the title card.
  premiere: { position: [0, 0.78, 7.6], target: [0, 0.5, 0] },
};

const scale = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];

export function getCameraPose(focus: CameraFocus, height = REFERENCE_HEIGHT): CameraPose {
  const s = height / REFERENCE_HEIGHT;
  const pose = REFERENCE_POSES[focus];
  return { position: scale(pose.position, s), target: scale(pose.target, s) };
}
