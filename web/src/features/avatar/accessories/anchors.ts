import { Triangle, Vector3, type Mesh } from 'three';

import { bandRing, principalAxes, type Vec3 } from './math';
import { posedVertex, type SurfaceMesh } from './surface';

/**
 * Anchor helpers that fit accessories to measured surfaces. They work on
 * plain geometry (positions in a body frame, triangle indices), so they apply
 * to any rig once its adapter has sampled the right meshes.
 */

// ---------------------------------------------------------------------------
// Ears

export interface EarAnchor {
  /** +1 for the character's left ear (frame +x), -1 for the right. */
  side: 1 | -1;
  /** Vertex indices of the ear on the sampled head-skin mesh. */
  vertices: number[];
  bottom: number;
  top: number;
  /** Lobe piercing point, mid-thickness, in frame coordinates. */
  lobe: Vec3;
  /** Outward unit normal of the lobe, in frame coordinates. */
  normal: Vec3;
}

export interface EarSearchOptions {
  /** Share of the ear height (from the bottom) that counts as lobe. */
  lobeFraction?: number;
  /** A separate ear shell is at most this share of the head mesh. */
  maxShellShare?: number;
}

const WELD = 1e-4;
const MIN_SHELL_VERTICES = 8;

/** Connected components of an indexed mesh after welding coincident vertices. */
export function weldedComponents(points: ArrayLike<number>, index: ArrayLike<number>): number[][] {
  const n = Math.floor(points.length / 3);
  const ids = new Map<string, number>();
  const welded = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(points[i * 3] / WELD)},${Math.round(points[i * 3 + 1] / WELD)},${Math.round(points[i * 3 + 2] / WELD)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = ids.size;
      ids.set(key, id);
    }
    welded[i] = id;
  }
  const parent = Int32Array.from({ length: ids.size }, (_, i) => i);
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let t = 0; t + 2 < index.length; t += 3) {
    union(welded[index[t]], welded[index[t + 1]]);
    union(welded[index[t + 1]], welded[index[t + 2]]);
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(welded[i]);
    const group = groups.get(root);
    if (group) group.push(i);
    else groups.set(root, [i]);
  }
  return [...groups.values()];
}

function earFrom(
  points: ArrayLike<number>,
  vertices: number[],
  side: 1 | -1,
  lobeFraction: number,
): EarAnchor {
  let bottom = Infinity;
  let top = -Infinity;
  for (const v of vertices) {
    bottom = Math.min(bottom, points[v * 3 + 1]);
    top = Math.max(top, points[v * 3 + 1]);
  }
  const height = top - bottom;
  const band = vertices.filter((v) => points[v * 3 + 1] <= bottom + lobeFraction * height);
  const fitSet = band.length >= 4 ? band : vertices;
  const coords = new Float32Array(fitSet.length * 3);
  fitSet.forEach((v, k) => {
    coords[k * 3] = points[v * 3];
    coords[k * 3 + 1] = points[v * 3 + 1];
    coords[k * 3 + 2] = points[v * 3 + 2];
  });
  const { mean, axes } = principalAxes(coords);
  const normal = [...axes[2]] as Vec3;
  if (normal[0] * side < 0) for (let k = 0; k < 3; k++) normal[k] = -normal[k];
  return {
    side,
    vertices,
    bottom,
    top,
    lobe: [mean[0], bottom + 0.4 * lobeFraction * height, mean[2]],
    normal,
  };
}

/**
 * Find the ears on a head-skin mesh. `points` are vertex positions in the
 * head frame (x left, y up, z forward, origin between the eyes). Ears built
 * as separate shells (VRoid, many game heads) are small lateral components
 * behind the eyes; for heads with welded ears the lateral extreme behind the
 * eyes is used instead.
 */
export function findEars(
  points: ArrayLike<number>,
  index: ArrayLike<number>,
  options: EarSearchOptions = {},
): { left?: EarAnchor; right?: EarAnchor } {
  const lobeFraction = options.lobeFraction ?? 0.22;
  const maxShare = options.maxShellShare ?? 0.2;
  const n = Math.floor(points.length / 3);
  let maxAbsX = 0;
  for (let i = 0; i < n; i++) maxAbsX = Math.max(maxAbsX, Math.abs(points[i * 3]));

  const shells: Record<1 | -1, number[]> = { 1: [], [-1]: [] };
  for (const group of weldedComponents(points, index)) {
    if (group.length < MIN_SHELL_VERTICES || group.length > maxShare * n) continue;
    let cx = 0;
    let cz = 0;
    for (const v of group) {
      cx += points[v * 3];
      cz += points[v * 3 + 2];
    }
    cx /= group.length;
    cz /= group.length;
    if (Math.abs(cx) > 0.6 * maxAbsX && cz < 0) shells[cx > 0 ? 1 : -1].push(...group);
  }

  const result: { left?: EarAnchor; right?: EarAnchor } = {};
  for (const side of [1, -1] as const) {
    let vertices = shells[side];
    if (vertices.length === 0) {
      // Welded ears: the outermost skin behind the eyes.
      let extreme = 0;
      for (let i = 0; i < n; i++) {
        if (points[i * 3 + 2] < 0) extreme = Math.max(extreme, points[i * 3] * side);
      }
      vertices = [];
      for (let i = 0; i < n; i++) {
        if (points[i * 3 + 2] < 0 && points[i * 3] * side >= extreme * 0.88) vertices.push(i);
      }
      if (extreme <= 0 || vertices.length < 4) continue;
    }
    const ear = earFrom(points, vertices, side, lobeFraction);
    if (side === 1) result.left = ear;
    else result.right = ear;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Bands around necks and wrists

/**
 * The band an accessory must clear around a limb or neck: the convex hull of
 * the surface points inside a slab, offset outward by `clearance`. `points`
 * are in a frame whose z runs along the limb, with the band's plane at z = 0;
 * returns a counter-clockwise xy loop (empty when too few points).
 */
export function crossSectionRing(
  points: ArrayLike<number>,
  halfThickness: number,
  clearance: number,
  count = 64,
): number[] {
  const slab: number[] = [];
  for (let i = 0; i + 2 < points.length; i += 3) {
    if (Math.abs(points[i + 2]) <= halfThickness) slab.push(points[i], points[i + 1]);
  }
  return slab.length >= 6 ? bandRing(slab, clearance, count) : [];
}

/** Mean distance of an xy loop from the origin. */
export function meanRadius(loop: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < loop.length; i += 2) sum += Math.hypot(loop[i], loop[i + 1]);
  return loop.length ? sum / (loop.length / 2) : 0;
}

// ---------------------------------------------------------------------------
// Points glued to deforming skin

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _ab = new Vector3();
const _ac = new Vector3();
const _closest = new Vector3();
const _bary = new Vector3();
const _triangle = new Triangle();

/**
 * A point glued to a deforming surface: three vertices plus barycentric
 * weights, re-evaluated through morph targets and skinning every frame
 * without allocating. Face piercings ride on these so they stay seated when
 * expressions or lip-sync move the skin.
 */
export class SkinPin {
  private constructor(
    readonly mesh: Mesh,
    private readonly a: number,
    private readonly b: number,
    private readonly c: number,
    private readonly wa: number,
    private readonly wb: number,
    private readonly wc: number,
    private readonly sign: number,
  ) {}

  /**
   * Pin to the point of `surface` nearest to `target` (world, measured in
   * the same pose as the surface). `outward` picks the normal's orientation.
   */
  static nearest(surface: SurfaceMesh, target: Vector3, outward?: Vector3): SkinPin | undefined {
    const { positions, index } = surface;
    let best = Infinity;
    let bestTri = -1;
    let wa = 0;
    let wb = 0;
    let wc = 0;
    for (let t = 0; t + 2 < index.length; t += 3) {
      _a.fromArray(positions, index[t] * 3);
      _b.fromArray(positions, index[t + 1] * 3);
      _c.fromArray(positions, index[t + 2] * 3);
      _triangle.set(_a, _b, _c);
      _triangle.closestPointToPoint(target, _closest);
      const d = _closest.distanceToSquared(target);
      if (d >= best || !_triangle.getBarycoord(_closest, _bary)) continue;
      best = d;
      bestTri = t;
      [wa, wb, wc] = [_bary.x, _bary.y, _bary.z];
    }
    if (bestTri < 0) return undefined;
    const [a, b, c] = [index[bestTri], index[bestTri + 1], index[bestTri + 2]];
    let sign = 1;
    if (outward) {
      _a.fromArray(positions, a * 3);
      _b.fromArray(positions, b * 3);
      _c.fromArray(positions, c * 3);
      _ab.subVectors(_b, _a).cross(_ac.subVectors(_c, _a));
      if (_ab.dot(outward) < 0) sign = -1;
    }
    return new SkinPin(surface.mesh, a, b, c, wa, wb, wc, sign);
  }

  /** Current world position and (optionally) unit surface normal. */
  evaluate(position: Vector3, normal?: Vector3): void {
    posedVertex(this.mesh, this.a, _a);
    posedVertex(this.mesh, this.b, _b);
    posedVertex(this.mesh, this.c, _c);
    position
      .set(0, 0, 0)
      .addScaledVector(_a, this.wa)
      .addScaledVector(_b, this.wb)
      .addScaledVector(_c, this.wc);
    if (normal) {
      normal
        .crossVectors(_ab.subVectors(_b, _a), _ac.subVectors(_c, _a))
        .normalize()
        .multiplyScalar(this.sign);
    }
  }
}
