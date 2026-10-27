/**
 * Area-uniform point sampling over posed triangle surfaces, for the landing
 * silhouette (see lib/silhouette/format.ts). Pure: the bench reads the posed
 * vertices out of the scene (collect.ts) and hands them over as arrays.
 */

export type Vec3 = readonly [number, number, number];

export interface Surface {
  /** For the report: which mesh the points came from. */
  name: string;
  /** Posed vertex positions, x, y, z per vertex. */
  positions: Float32Array;
  /** Three vertex indices per triangle. */
  indices: Uint32Array;
  /**
   * Per-vertex hide flag, as the body skin shader reads it: a point whose
   * interpolated value is over 0.5 is discarded there, so it is not sampled.
   */
  hidden: Float32Array | null;
  /** Density multiplier of the whole surface (layered hair cards: below 1). */
  weight: number;
  /** The outer-shell group it takes part in (see keepOuterShell). */
  shell?: string;
}

export interface SampleOptions {
  count: number;
  seed: number;
  /** Triangles centred above `above` (m) get `weight` times the density: the face reads at small scale. */
  region?: { above: number; weight: number };
}

export interface Sampled {
  /** x, y, z per point, shuffled: any prefix is an unbiased subset. */
  points: Float32Array;
  /** Points per surface, in surface order. */
  perSurface: number[];
}

/** Small seeded PRNG (mulberry32): the same seed gives the same file. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A triangle drawn whole, or one partly under clothes whose points are tested one by one. */
const SHOWN = 0;
const PARTLY = 1;

/** Gives up when hiding rejects this many draws per point asked for (a fully hidden surface). */
const MAX_DRAWS_PER_POINT = 200;

/**
 * Draws `count` points, each on a triangle picked with probability
 * proportional to its area times its density weight (inverse CDF), at a
 * uniformly random spot inside it. Points the skin shader would discard are
 * drawn again. Then the points are shuffled.
 */
export function sampleSurfaces(surfaces: readonly Surface[], options: SampleOptions): Sampled {
  const { count, seed, region } = options;
  const triangles = surfaces.reduce((sum, surface) => sum + surface.indices.length / 3, 0);
  const cdf = new Float64Array(triangles);
  const owner = new Uint16Array(triangles);
  const first = new Uint32Array(triangles);
  const cover = new Uint8Array(triangles);
  let total = 0;
  let k = 0;
  surfaces.forEach((surface, s) => {
    const { positions: p, indices, hidden, weight } = surface;
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t]! * 3;
      const b = indices[t + 1]! * 3;
      const c = indices[t + 2]! * 3;
      let area = triangleArea(p, a, b, c) * weight;
      if (region && (p[a + 1]! + p[b + 1]! + p[c + 1]!) / 3 > region.above) area *= region.weight;
      let state = SHOWN;
      if (hidden) {
        const over = [indices[t]!, indices[t + 1]!, indices[t + 2]!].filter(
          (v) => hidden[v]! > 0.5,
        ).length;
        // All three over the threshold: every point inside is too.
        if (over === 3) area = 0;
        else if (over > 0) state = PARTLY;
      }
      total += area;
      cdf[k] = total;
      owner[k] = s;
      first[k] = t;
      cover[k] = state;
      k += 1;
    }
  });
  if (!(total > 0)) throw new Error('Nothing to sample: no visible surface area');

  const random = seededRandom(seed);
  const points = new Float32Array(count * 3);
  const perSurface = surfaces.map(() => 0);
  let draws = 0;
  for (let i = 0; i < count;) {
    if (++draws > count * MAX_DRAWS_PER_POINT)
      throw new Error('Sampling kept landing on hidden skin');
    const tri = lowerBound(cdf, random() * total);
    const surface = surfaces[owner[tri]!]!;
    const t = first[tri]!;
    const va = surface.indices[t]!;
    const vb = surface.indices[t + 1]!;
    const vc = surface.indices[t + 2]!;
    // Uniform barycentric coordinates (Osada et al.).
    const r1 = Math.sqrt(random());
    const r2 = random();
    const u = 1 - r1;
    const v = r1 * (1 - r2);
    const w = r1 * r2;
    if (cover[tri] === PARTLY) {
      const hidden = surface.hidden!;
      if (u * hidden[va]! + v * hidden[vb]! + w * hidden[vc]! > 0.5) continue;
    }
    const p = surface.positions;
    for (let axis = 0; axis < 3; axis += 1) {
      points[i * 3 + axis] = u * p[va * 3 + axis]! + v * p[vb * 3 + axis]! + w * p[vc * 3 + axis]!;
    }
    perSurface[owner[tri]!]! += 1;
    i += 1;
  }
  shufflePoints(points, random);
  return { points, perSurface };
}

function triangleArea(p: Float32Array, a: number, b: number, c: number): number {
  const abx = p[b]! - p[a]!;
  const aby = p[b + 1]! - p[a + 1]!;
  const abz = p[b + 2]! - p[a + 2]!;
  const acx = p[c]! - p[a]!;
  const acy = p[c + 1]! - p[a + 1]!;
  const acz = p[c + 2]! - p[a + 2]!;
  const x = aby * acz - abz * acy;
  const y = abz * acx - abx * acz;
  const z = abx * acy - aby * acx;
  return 0.5 * Math.sqrt(x * x + y * y + z * z);
}

/** First index whose cumulative weight exceeds `value` (skips zero-area triangles). */
function lowerBound(cdf: Float64Array, value: number): number {
  let low = 0;
  let high = cdf.length - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (cdf[mid]! > value) high = mid;
    else low = mid + 1;
  }
  return low;
}

/** Fisher-Yates over whole points. */
function shufflePoints(points: Float32Array, random: () => number): void {
  for (let i = points.length / 3 - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    for (let axis = 0; axis < 3; axis += 1) {
      const swap = points[i * 3 + axis]!;
      points[i * 3 + axis] = points[j * 3 + axis]!;
      points[j * 3 + axis] = swap;
    }
  }
}

export interface ShellOptions {
  /** The surfaces that take part: those whose `shell` is this group. */
  group: string;
  /**
   * `point`: directions from `centre` (the skull's centre: a head is round).
   * `axis`: directions around the vertical line through it, slice by slice
   * (a waist: the top's hem over the bottom's waistband).
   */
  around: 'point' | 'axis';
  centre: Vec3;
  /** Triangles more than this (m) inside the outermost one in their direction are dropped. */
  depth: number;
  /** Only triangles centred in this height band (m) take part. */
  above: number;
  below?: number;
}

/** Point mode: bins around (yaw) and up-down (pitch), about 4° each. */
const SPHERE_BINS = [96, 48] as const;
/** Axis mode: bins around, and the height of a slice (m). */
const AXIS_BINS = 96;
const AXIS_SLICE = 0.01;

/**
 * Keeps what a viewer sees of layered surfaces: in each direction, only the
 * triangles of the group within `depth` of the outermost one there. Hair
 * cards are stacked many layers deep and the scalp and ears lie under them:
 * those go, while the face, with no hair in front of it, stays. At the waist
 * the bottom's waistband under the top's hem goes. Other surfaces and
 * everything outside the height band pass unchanged.
 */
export function keepOuterShell(surfaces: readonly Surface[], options: ShellOptions): Surface[] {
  const { group, around, centre, depth, above, below = Infinity } = options;
  const axis = around === 'axis';
  if (axis && !Number.isFinite(below)) throw new Error('An axis shell needs a height band');
  const [aroundBins, otherBins] = axis
    ? [AXIS_BINS, Math.ceil((below - above) / AXIS_SLICE) + 1]
    : SPHERE_BINS;
  const outermost = new Float32Array(aroundBins * otherBins);
  const binOf = (x: number, y: number, z: number): [number, number] => {
    const dx = x - centre[0];
    const dy = y - centre[1];
    const dz = z - centre[2];
    const r = axis ? Math.hypot(dx, dz) : Math.hypot(dx, dy, dz);
    const yaw = (Math.atan2(dx, dz) + Math.PI) / (2 * Math.PI);
    const other = axis
      ? Math.floor((y - above) / AXIS_SLICE)
      : Math.floor(((r > 0 ? Math.asin(dy / r) : 0) / Math.PI + 0.5) * otherBins);
    const bin =
      Math.min(otherBins - 1, Math.max(0, other)) * aroundBins +
      Math.min(aroundBins - 1, Math.floor(yaw * aroundBins));
    return [bin, r];
  };
  const centroid = (p: Float32Array, indices: Uint32Array, t: number, axis: number) =>
    (p[indices[t]! * 3 + axis]! + p[indices[t + 1]! * 3 + axis]! + p[indices[t + 2]! * 3 + axis]!) /
    3;
  const each = (visit: (surface: Surface, t: number, bin: number, r: number) => void) => {
    for (const surface of surfaces) {
      if (surface.shell !== group) continue;
      const { positions: p, indices } = surface;
      for (let t = 0; t < indices.length; t += 3) {
        const y = centroid(p, indices, t, 1);
        if (y <= above || y > below) continue;
        const [bin, r] = binOf(centroid(p, indices, t, 0), y, centroid(p, indices, t, 2));
        visit(surface, t, bin, r);
      }
    }
  };
  each((_, __, bin, r) => {
    if (r > outermost[bin]!) outermost[bin] = r;
  });
  const dropped = new Map<Surface, Set<number>>();
  each((surface, t, bin, r) => {
    if (r >= outermost[bin]! - depth) return;
    let set = dropped.get(surface);
    if (!set) dropped.set(surface, (set = new Set()));
    set.add(t);
  });
  return surfaces.map((surface) => {
    const drop = dropped.get(surface);
    if (!drop) return surface;
    const kept = new Uint32Array(surface.indices.length - drop.size * 3);
    let k = 0;
    for (let t = 0; t < surface.indices.length; t += 3) {
      if (drop.has(t)) continue;
      kept[k++] = surface.indices[t]!;
      kept[k++] = surface.indices[t + 1]!;
      kept[k++] = surface.indices[t + 2]!;
    }
    return { ...surface, indices: kept };
  });
}

/**
 * The turn about +Y (radians) that makes a chest face +Z, from the world
 * positions of its left and right clavicle: facing +Z, the line from the
 * right one to the left one runs along +X (the viewer's right).
 */
export function turnToFaceViewer(left: Vec3, right: Vec3): number {
  const across = [left[0] - right[0], left[2] - right[2]] as const;
  // Forward is across x up: (-across.z, across.x) in (x, z).
  return -Math.atan2(-across[1], across[0]);
}

/** Lean of a line from vertical (degrees): in the front view (+ toward +x) and the side view (+ toward +z). */
export interface Tilt {
  front: number;
  side: number;
}

export function tiltOf(from: Vec3, to: Vec3): Tilt {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const deg = (radians: number) => (radians * 180) / Math.PI;
  return { front: deg(Math.atan2(dx, dy)), side: deg(Math.atan2(dz, dy)) };
}

export interface Normalized {
  points: Float32Array;
  /** Figure height (m) before scaling: lowest to highest point. */
  height: number;
  /** Horizontal centre (m) the points were moved from. */
  centre: { x: number; z: number };
}

/**
 * Feet (lowest point) to the top of the head (highest) mapped onto y -1..1;
 * x and z scaled by the same factor (half the height) and centred on the
 * points' bounding box.
 */
export function normalizeFigure(points: Float32Array): Normalized {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = points[i + axis]!;
      if (value < min[axis]!) min[axis] = value;
      if (value > max[axis]!) max[axis] = value;
    }
  }
  const height = max[1]! - min[1]!;
  if (!(height > 0)) throw new Error('A figure needs some height');
  const half = height / 2;
  const centre = { x: (min[0]! + max[0]!) / 2, z: (min[2]! + max[2]!) / 2 };
  const out = new Float32Array(points.length);
  for (let i = 0; i < points.length; i += 3) {
    out[i] = (points[i]! - centre.x) / half;
    out[i + 1] = (points[i + 1]! - min[1]!) / half - 1;
    out[i + 2] = (points[i + 2]! - centre.z) / half;
  }
  return { points: out, height, centre };
}
