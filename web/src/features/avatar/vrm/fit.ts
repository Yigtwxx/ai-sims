import type { Vec3 } from './boneAxes';

/**
 * Pure geometry for refitting parts between bodies. A part (hair, garment)
 * was authored around its source model; joint positions line up limbs, but a
 * taller skull pokes through that model's hair cap and broader shoulders
 * through its jacket. So both bodies are summarised as radial profiles around
 * each bone (skin radius per direction bin, canonical axes x left, y up,
 * z forward, bind pose), and the part is scaled by the ratio of the base
 * profile to its source's profile: the authored gap between part and body is
 * kept, whatever the two bodies look like.
 */

export interface BoneFit {
  /** Per-axis scale in canonical axes. */
  scale: Vec3;
  /** Translation of the part's contents in canonical axes (metres, before height scaling). */
  offset: Vec3;
}

/** Robust outer skin radius per direction bin. */
export type RadialBins = Record<string, number>;

export interface HeadProfile {
  /** Skull centre relative to the head joint. */
  centre: Vec3;
  bins: RadialBins;
}

export interface LimbProfile {
  /** Unit direction from the joint to its child. */
  axis: Vec3;
  /** Joint-to-child distance (metres). */
  length: number;
  bins: RadialBins;
}

export interface FitRange {
  min: number;
  max: number;
}

const DEG = Math.PI / 180;
// Outer surface, ignoring a few stray vertices.
const OUTER = 0.95;
const MIN_SAMPLES = 4;

function percentile(values: number[], fraction: number): number {
  values.sort((a, b) => a - b);
  const position = (values.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.min(values.length - 1, lower + 1);
  return values[lower] + (values[upper] - values[lower]) * (position - lower);
}

function robustBins(lists: Map<string, number[]>): RadialBins {
  const bins: RadialBins = {};
  for (const [key, values] of lists) {
    if (values.length >= MIN_SAMPLES) bins[key] = percentile(values, OUTER);
  }
  return bins;
}

/* ----------------------------------------------------------------------- *
 * Head: spherical bins around the skull centre. Only the part a hair cap
 * covers is binned: everything above the ears, plus the back of the head.
 * The face, ears and neck would only add noise.
 * ----------------------------------------------------------------------- */

const AZIMUTH_BINS = 12;
const ELEVATION_BANDS: readonly [number, number][] = [
  [-15, 20],
  [20, 40],
  [40, 60],
  [60, 90.1],
];
const BACK_SECTOR = 120 * DEG;

function headBinKey(dx: number, dy: number, dz: number): string | undefined {
  const radius = Math.hypot(dx, dy, dz);
  if (radius < 1e-4) return undefined;
  const elevation = Math.asin(dy / radius);
  const azimuth = Math.atan2(dx, dz); // 0 = forward, ±π = back
  const band = ELEVATION_BANDS.findIndex(
    ([lo, hi]) => elevation >= lo * DEG && elevation < hi * DEG,
  );
  if (band < 0 || (band === 0 && Math.abs(azimuth) < BACK_SECTOR)) return undefined;
  const sector = Math.min(
    AZIMUTH_BINS - 1,
    Math.floor(((azimuth + Math.PI) / (2 * Math.PI)) * AZIMUTH_BINS),
  );
  return `${band}:${sector}`;
}

function headBinDirection(key: string): Vec3 {
  const [band, sector] = key.split(':').map(Number);
  const [lo, hi] = ELEVATION_BANDS[band];
  const elevation = ((lo + Math.min(hi, 90)) / 2) * DEG;
  const azimuth = ((sector + 0.5) / AZIMUTH_BINS) * 2 * Math.PI - Math.PI;
  return [
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation),
  ];
}

/** Profile of skull points (flat xyz, relative to the head joint). */
export function headProfile(points: ArrayLike<number>): HeadProfile | undefined {
  if (points.length < 3) return undefined;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], points[i + k]);
      max[k] = Math.max(max[k], points[i + k]);
    }
  }
  const centre: Vec3 = [0, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const lists = new Map<string, number[]>();
  for (let i = 0; i < points.length; i += 3) {
    const dx = points[i] - centre[0];
    const dy = points[i + 1] - centre[1];
    const dz = points[i + 2] - centre[2];
    const key = headBinKey(dx, dy, dz);
    if (!key) continue;
    let list = lists.get(key);
    if (!list) lists.set(key, (list = []));
    list.push(Math.hypot(dx, dy, dz));
  }
  return { centre, bins: robustBins(lists) };
}

/* ----------------------------------------------------------------------- *
 * Limbs and torso: bins by position along the segment and angle around it.
 * ----------------------------------------------------------------------- */

const SECTORS = 8;
const SLABS = 3;

/** The canonical axis a segment runs along, and the two across it. */
function frameOf(axis: Vec3): { along: number; across: [number, number] } {
  const abs = axis.map(Math.abs);
  const along = abs.indexOf(Math.max(...abs));
  const across = [0, 1, 2].filter((i) => i !== along) as [number, number];
  return { along, across };
}

/** Profile of a segment's skin points (flat xyz, relative to its joint). */
export function limbProfile(
  points: ArrayLike<number>,
  axis: Vec3,
  length: number,
): LimbProfile | undefined {
  if (points.length < 3 || length <= 1e-4) return undefined;
  const { across } = frameOf(axis);
  const [u, v] = across;
  const lists = new Map<string, number[]>();
  for (let i = 0; i < points.length; i += 3) {
    const p: Vec3 = [points[i], points[i + 1], points[i + 2]];
    const t = p[0] * axis[0] + p[1] * axis[1] + p[2] * axis[2];
    if (t < -0.15 * length || t > 1.15 * length) continue;
    const radial: Vec3 = [p[0] - t * axis[0], p[1] - t * axis[1], p[2] - t * axis[2]];
    const radius = Math.hypot(radial[0], radial[1], radial[2]);
    if (radius < 1e-4) continue;
    const slab = Math.min(SLABS - 1, Math.max(0, Math.floor((t / length) * SLABS)));
    const angle = Math.atan2(radial[v], radial[u]);
    const sector = Math.min(SECTORS - 1, Math.floor(((angle + Math.PI) / (2 * Math.PI)) * SECTORS));
    const key = `${slab}:${sector}`;
    let list = lists.get(key);
    if (!list) lists.set(key, (list = []));
    list.push(radius);
  }
  return { axis, length, bins: robustBins(lists) };
}

function limbBinDirection(key: string, axis: Vec3): Vec3 {
  const sector = Number(key.split(':')[1]);
  const { across } = frameOf(axis);
  const middle = ((sector + 0.5) / SECTORS) * 2 * Math.PI - Math.PI;
  const direction: Vec3 = [0, 0, 0];
  direction[across[0]] = Math.cos(middle);
  direction[across[1]] = Math.sin(middle);
  return direction;
}

/* ----------------------------------------------------------------------- *
 * Fitting.
 * ----------------------------------------------------------------------- */

/**
 * Per-axis scale that brings every bin to at least its base/source ratio:
 * each axis takes the largest ratio among the bins pointing along it, then
 * bins still short (diagonals) raise all axes together. Never cutting into
 * the base matters more than matching exactly, hence "at least".
 */
function solveScale(ratios: { direction: Vec3; ratio: number }[], range: FitRange): Vec3 {
  const scale: Vec3 = [0, 0, 0];
  for (const { direction, ratio } of ratios) {
    const abs = direction.map(Math.abs);
    const axis = abs.indexOf(Math.max(...abs));
    scale[axis] = Math.max(scale[axis], ratio);
  }
  for (let i = 0; i < 3; i++) if (scale[i] === 0) scale[i] = 1;
  for (const { direction, ratio } of ratios) {
    const achieved = Math.hypot(
      scale[0] * direction[0],
      scale[1] * direction[1],
      scale[2] * direction[2],
    );
    if (achieved > 0 && achieved < ratio) {
      const bump = ratio / achieved;
      for (let i = 0; i < 3; i++) scale[i] *= bump;
    }
  }
  return scale.map((s) => Math.min(range.max, Math.max(range.min, s))) as Vec3;
}

const isIdentity = (scale: Vec3) => scale.every((s) => Math.abs(s - 1) < 0.004);

/**
 * Hair fit: map the source skull onto the base skull. The scale happens about
 * the skull centre and the offset also moves the source centre onto the base
 * one, so a skull that sits higher above its neck joint is followed too.
 */
export function fitHeadProfiles(
  base: HeadProfile,
  source: HeadProfile,
  range: FitRange,
): BoneFit | undefined {
  const ratios: { direction: Vec3; ratio: number }[] = [];
  for (const [key, radius] of Object.entries(base.bins)) {
    const sourceRadius = source.bins[key];
    if (sourceRadius && sourceRadius > 1e-4) {
      ratios.push({ direction: headBinDirection(key), ratio: radius / sourceRadius });
    }
  }
  if (ratios.length === 0) return undefined;
  const scale = solveScale(ratios, range);
  const offset: Vec3 = [
    base.centre[0] - scale[0] * source.centre[0],
    base.centre[1] - scale[1] * source.centre[1],
    base.centre[2] - scale[2] * source.centre[2],
  ];
  if (isIdentity(scale) && offset.every((o) => Math.abs(o) < 5e-4)) return undefined;
  return { scale, offset };
}

/** Garment fit around one segment: girth follows the ratio of the two bodies, length stays. */
export function fitLimbProfiles(
  base: LimbProfile,
  source: LimbProfile,
  range: FitRange,
): BoneFit | undefined {
  const ratios: { direction: Vec3; ratio: number }[] = [];
  for (const [key, radius] of Object.entries(base.bins)) {
    const sourceRadius = source.bins[key];
    if (sourceRadius && sourceRadius > 1e-4) {
      ratios.push({ direction: limbBinDirection(key, base.axis), ratio: radius / sourceRadius });
    }
  }
  if (ratios.length === 0) return undefined;
  const scale = solveScale(ratios, range);
  scale[frameOf(base.axis).along] = 1;
  if (isIdentity(scale)) return undefined;
  return { scale, offset: [0, 0, 0] };
}
