/**
 * Camera framing presets per creator category, authored for a reference
 * character standing at the origin facing +Z and scaled to the actual
 * character height so a 1.5 m anime avatar and a 1.85 m human frame alike.
 */

export type CameraFocus =
  'body' | 'face' | 'torso' | 'legs' | 'feet' | 'premiere' | 'brows' | 'mouth' | 'top' | 'shoes';

type Vec3 = readonly [number, number, number];

export interface CameraPose {
  position: Vec3;
  target: Vec3;
}

const scale = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];

/** Height (metres) the presets below were authored for. */
export const REFERENCE_HEIGHT = 1.85;

/**
 * Close-ups for item thumbnails, as offsets from the subject's eye centre
 * (the midpoint of the eyeballs): both brows with the eyes under them, and the
 * lower face from the nose to under the chin (beards and mustaches). Anchored
 * on the eyes because the idle pose moves the head a few centimetres off the
 * axis, which a fixed height would leave off-centre at this distance.
 */
const CLOSE_UP_OFFSETS = {
  brows: { position: [0, 0.015, 0.36], target: [0, 0.01, 0] },
  mouth: { position: [0, -0.09, 0.38], target: [0, -0.1, 0] },
} as const satisfies Record<string, CameraPose>;

type CloseUp = keyof typeof CLOSE_UP_OFFSETS;

/** Where the eye centre of the reference character sits; places a close-up before it is measured. */
const REFERENCE_EYES: Vec3 = [0, 1.72, 0.07];

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const around = (eyes: Vec3, offset: CameraPose, s: number): CameraPose => ({
  position: add(eyes, scale(offset.position, s)),
  target: add(eyes, scale(offset.target, s)),
});

const REFERENCE_POSES: Record<CameraFocus, CameraPose> = {
  body: { position: [0, 1.02, 5.9], target: [0, 0.9, 0] },
  face: { position: [0.05, 1.74, 1.6], target: [0, 1.68, 0.05] },
  torso: { position: [0, 1.42, 2.6], target: [0, 1.36, 0] },
  legs: { position: [0, 0.75, 3.0], target: [0, 0.6, 0] },
  feet: { position: [0.1, 0.55, 1.7], target: [0, 0.1, 0] },
  // Item thumbnails: a top from the chin to the hips, slightly from the side so
  // the cloth reads in depth; both shoes low and close, three quarters front.
  top: { position: [0.32, 1.3, 2.15], target: [0, 1.21, 0] },
  shoes: { position: [0.42, 0.3, 1.05], target: [0, 0.07, 0.04] },
  // Smaller and higher in frame, leaving the lower third for the title card.
  premiere: { position: [0, 0.78, 7.6], target: [0, 0.5, 0] },
  brows: around(REFERENCE_EYES, CLOSE_UP_OFFSETS.brows, 1),
  mouth: around(REFERENCE_EYES, CLOSE_UP_OFFSETS.mouth, 1),
};

export function getCameraPose(focus: CameraFocus, height = REFERENCE_HEIGHT): CameraPose {
  const s = height / REFERENCE_HEIGHT;
  const pose = REFERENCE_POSES[focus];
  return { position: scale(pose.position, s), target: scale(pose.target, s) };
}

/** True for the framings that follow the subject's eyes (see closeUpPose). */
export function isCloseUp(focus: CameraFocus): focus is CloseUp {
  return Object.hasOwn(CLOSE_UP_OFFSETS, focus);
}

/**
 * A close-up framed on the measured eye centre (world, metres), its offsets
 * scaled like the presets. Null for the framings that are not close-ups.
 */
export function closeUpPose(
  focus: CameraFocus,
  eyes: Vec3,
  height = REFERENCE_HEIGHT,
): CameraPose | null {
  return isCloseUp(focus) ? around(eyes, CLOSE_UP_OFFSETS[focus], height / REFERENCE_HEIGHT) : null;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Talk-screen framing between the full body (0) and the face (1). Eased, so
 * equal zoom steps feel even and the end points settle softly.
 */
export function zoomPose(zoom: number, height = REFERENCE_HEIGHT): CameraPose {
  const t = smooth(Math.min(1, Math.max(0, zoom)));
  const from = getCameraPose('body', height);
  const to = getCameraPose('face', height);
  const mix = (a: Vec3, b: Vec3): Vec3 => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
  return { position: mix(from.position, to.position), target: mix(from.target, to.target) };
}
