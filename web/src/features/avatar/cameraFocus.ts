/**
 * Camera framing presets per creator category, authored for a reference
 * character standing at the origin facing +Z and scaled to the actual
 * character height so a 1.5 m anime avatar and a 1.85 m human frame alike.
 */

export type CameraFocus =
  | 'body'
  | 'face'
  | 'head'
  | 'torso'
  | 'upper'
  | 'legs'
  | 'feet'
  | 'premiere'
  | 'brows'
  | 'mouth'
  | 'top'
  | 'shoes'
  | TattooFocus;

/** Close framings of each tattoo placement (see TATTOO_FOCUS). */
export type TattooFocus =
  | 'tattooWrist'
  | 'tattooForearm'
  | 'tattooCollarbone'
  | 'tattooEar'
  | 'tattooAnkle'
  | 'tattooBack'
  | 'tattooNape';

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
  // Creator framings, with room to spare: the face categories show the head
  // and both shoulders with headroom for tall hair (face stays the talk
  // close-up); a top shows from mid-thigh to above the head (torso stays the
  // card portrait); the bottoms from the feet to the waist. An idle sway or a
  // turn of the head never takes the subject out of frame.
  head: { position: [0.05, 1.72, 1.95], target: [0, 1.65, 0.05] },
  upper: { position: [0, 1.42, 3.3], target: [0, 1.35, 0] },
  legs: { position: [0, 0.72, 3.25], target: [0, 0.58, 0] },
  feet: { position: [0.1, 0.55, 1.7], target: [0, 0.1, 0] },
  // Item thumbnails: a top from the chin to the hips, slightly from the side so
  // the cloth reads in depth; both shoes low and close, three quarters front.
  top: { position: [0.32, 1.3, 2.15], target: [0, 1.21, 0] },
  shoes: { position: [0.42, 0.3, 1.05], target: [0, 0.07, 0.04] },
  // Smaller and higher in frame, leaving the lower third for the title card.
  premiere: { position: [0, 0.78, 7.6], target: [0, 0.5, 0] },
  brows: around(REFERENCE_EYES, CLOSE_UP_OFFSETS.brows, 1),
  mouth: around(REFERENCE_EYES, CLOSE_UP_OFFSETS.mouth, 1),
  // Tattoo placements, with the character turned by FOCUS_HEADING first (the
  // targets are where the spot is once turned): close enough for a 2-5 cm
  // design to read, wide enough that an idle sway keeps it in frame.
  tattooWrist: { position: [0.15, 1.2, 1.5], target: [0.18, 0.98, 0] },
  tattooForearm: { position: [-0.35, 1.08, 0.85], target: [-0.22, 1.02, 0.12] },
  tattooCollarbone: { position: [0.05, 1.5, 0.75], target: [0.05, 1.46, 0.08] },
  tattooEar: { position: [0.04, 1.72, 0.6], target: [0.04, 1.7, 0.06] },
  tattooAnkle: { position: [0.18, 0.3, 0.75], target: [0.09, 0.15, 0.08] },
  tattooBack: { position: [0.1, 1.48, 0.9], target: [0.095, 1.44, 0.1] },
  tattooNape: { position: [0, 1.6, 0.7], target: [0, 1.56, 0.08] },
};

/**
 * How far the turntable turns the character for a framing (radians from
 * facing the viewer, counter-clockwise from above), so the spot faces the
 * studio lights: the right ear's back from behind its shoulder, the left
 * ankle's outside, the back and the nape all the way round.
 */
const FOCUS_HEADING: Partial<Record<CameraFocus, number>> = {
  tattooEar: 2.6,
  tattooAnkle: -1,
  tattooBack: Math.PI,
  tattooNape: Math.PI,
};

export function focusHeading(focus: CameraFocus): number {
  return FOCUS_HEADING[focus] ?? 0;
}

/**
 * How a tattoo spot is framed: the camera's distance (m; the camera rig's own
 * minimum is 0.6), how much it follows the skin's normal and how far it rises
 * above the spot.
 */
const TATTOO_VIEW: Record<TattooFocus, { distance: number; normal: number; lift: number }> = {
  tattooWrist: { distance: 0.66, normal: 0.7, lift: 0.3 },
  tattooForearm: { distance: 0.7, normal: 0.8, lift: 0.15 },
  tattooCollarbone: { distance: 0.66, normal: 1, lift: 0.15 },
  tattooEar: { distance: 0.62, normal: 1, lift: 0.1 },
  tattooAnkle: { distance: 0.7, normal: 1, lift: 0.3 },
  tattooBack: { distance: 0.8, normal: 1, lift: 0.15 },
  tattooNape: { distance: 0.66, normal: 1, lift: 0.15 },
};

export function isTattooFocus(focus: CameraFocus): focus is TattooFocus {
  return Object.hasOwn(TATTOO_VIEW, focus);
}

/**
 * A tattoo framed where it actually is (world, m): looked at along the skin's
 * outward normal, leaned towards the viewer's side of the stage (+z, where
 * the turntable turned the spot) and a little from above.
 */
export function spotPose(focus: TattooFocus, point: Vec3, normal: Vec3): CameraPose {
  const view = TATTOO_VIEW[focus];
  const direction: Vec3 = [
    normal[0] * view.normal,
    normal[1] * view.normal + view.lift,
    normal[2] * view.normal + 0.8,
  ];
  const length = Math.hypot(...direction) || 1;
  return {
    position: [
      point[0] + (direction[0] / length) * view.distance,
      point[1] + (direction[1] / length) * view.distance,
      point[2] + (direction[2] / length) * view.distance,
    ],
    target: point,
  };
}

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
