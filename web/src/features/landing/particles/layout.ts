import { LAST_STAGE } from './story';

/** Below this width the copy sits under the shapes instead of beside them. */
export const NARROW = 820;

/** How much each whole shape spins with time and scroll; flat shapes face the viewer. */
const SPIN = [0.3, 1, 0, 0.2, 0, 0] as const;
/** Forward tilt of each shape (radians), enough to read as 3D. */
const PITCH = [0.18, 0.25, 0.12, 0.06, 0.1, 0] as const;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Linear blend of a per-shape value at a continuous stage. */
export function perStage(values: readonly number[], stage: number): number {
  const s = Math.min(values.length - 1, Math.max(0, stage));
  const i = Math.floor(s);
  const j = Math.min(values.length - 1, i + 1);
  return values[i] + (values[j] - values[i]) * (s - i);
}

export const spinWeight = (stage: number) => perStage(SPIN, stage);
export const pitchAt = (stage: number) => perStage(PITCH, stage);

export interface StageLayout {
  centerX: number;
  centerY: number;
  /** CSS px per unit (the sphere's radius). */
  scale: number;
  /** Silhouette units per normalised unit: half its height in sphere radii. */
  silScale: number;
}

/**
 * Where the shapes sit. Wide screens: right of the copy, the silhouette head to
 * toe in ~80% of the height. Narrow screens: above the copy, smaller.
 */
export function layoutFor(width: number, height: number, stage: number): StageLayout {
  const narrow = width < NARROW;
  const scale = Math.min(width, height) * (narrow ? 0.3 : 0.27);
  const baseY = height * (narrow ? 0.36 : 0.47);
  // Phones stack the last chapter's copy (title, body, button, notice) under
  // the silhouette, so it stands smaller and higher there.
  const silY = height * (narrow ? 0.27 : 0.5);
  const silHalf = height * (narrow ? 0.2 : 0.41);
  const toSilhouette = clamp01(stage - (LAST_STAGE - 1));
  return {
    centerX: width * (narrow ? 0.5 : 0.6),
    centerY: baseY + (silY - baseY) * toSilhouette,
    scale,
    silScale: silHalf / Math.max(1, scale),
  };
}

/** Points drawn at a width; phones get half. */
export function pointCountFor(width: number): number {
  return width < NARROW ? 3500 : 7000;
}
