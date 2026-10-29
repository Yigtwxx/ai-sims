import {
  BufferAttribute,
  BufferGeometry,
  SkinnedMesh,
  Vector2,
  Vector3,
  type InterleavedBufferAttribute,
  type Material,
  type Object3D,
} from 'three';

import { BODY_HIDDEN } from './garments';
import { ARM_HEIGHT, LEG_HEIGHT, TOE_WEIGHT, type SockFabric, type SockWear } from './socks';

/**
 * The sock's top edge as real geometry. The socks are drawn on the skin, and the
 * triangles their edge crosses are about a centimetre tall, so no displacement of
 * the skin's own vertices gives a crisp step: the knit seemed painted on. This is
 * a thin ring along the edge, built on the body's own triangles where the edge
 * crosses them: a rolled cuff that stands off the skin and tapers down into the
 * sock. Its lower rows sit on the skin at their own height (found by casting
 * across the leg), so the taper follows the leg's slope and the ankle bone, and
 * it ends by tucking steeply under the skin: a shallow approach left a ragged
 * seam where the skin's facets poked through. It takes every attribute from the
 * triangles it sits on (UVs, skin weights, body slider morphs, the mask of skin
 * under garments) and wears the body's skin material, so it is the same knit in
 * the same light, hidden with the skin.
 */

/** Cross-section of the cuff: outward offset and height from the edge (m), top first. */
export interface CuffProfile {
  points: readonly (readonly [out: number, up: number])[];
}

const UV_PER_METRE = 0.65;
/** Columns per crossed triangle: the skin under a long chord would bulge through it. */
const COLUMNS = 4;
/** How far across the skin (m) a lower row looks for the skin at its height. */
const REACH = 0.02;
/**
 * How far in UV the skin a lower row sits on may be from the edge above it. Past
 * a UV seam (the front of the waist) the nearest skin can be the other island's:
 * a quad between the two would smear the whole atlas across the cuff.
 */
const UV_REACH = 0.06;
/** Cell size (m) of the grid the skin's triangles are bucketed in, across the floor. */
const CELL = 0.02;

/**
 * The cuff of each fabric: a rolled knit band, or the flat waistband of tights,
 * tapering to just over the skin and tucking under it.
 */
export function cuffProfile(fabric: SockFabric, depth: number): CuffProfile {
  const nylon = fabric === 'nylon';
  const thick = nylon ? 0.0009 : 0.0021;
  const band = Math.min(depth * 0.4, nylon ? 0.012 : 0.006);
  const rest = nylon ? 0.0003 : 0.0005;
  return {
    points: [
      [0.0002, 0.0003],
      [thick * 0.7, 0.0004],
      [thick, -0.0006],
      [thick * 0.95, -band],
      [rest, -depth],
      [-0.0008, -depth - 0.0012],
    ],
  };
}

/** A point on a body triangle: its corners and their barycentric weights. */
interface SurfacePoint {
  corners: readonly [number, number, number];
  weights: readonly [number, number, number];
}

type Attribute = BufferAttribute | InterleavedBufferAttribute;

const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

function sample3(attribute: Attribute, point: SurfacePoint, target: Vector3): Vector3 {
  target.set(0, 0, 0);
  for (let k = 0; k < 3; k += 1) {
    const vertex = point.corners[k]!;
    const w = point.weights[k]!;
    target.x += attribute.getX(vertex) * w;
    target.y += attribute.getY(vertex) * w;
    target.z += attribute.getZ(vertex) * w;
  }
  return target;
}

function sample2(attribute: Attribute, point: SurfacePoint, target: Vector2): Vector2 {
  target.set(0, 0);
  for (let k = 0; k < 3; k += 1) {
    target.x += attribute.getX(point.corners[k]!) * point.weights[k]!;
    target.y += attribute.getY(point.corners[k]!) * point.weights[k]!;
  }
  return target;
}

/** Up to four strongest bone influences of a point between vertices. */
function blendInfluences(
  indices: ArrayLike<number>,
  weights: ArrayLike<number>,
  point: SurfacePoint,
): { index: number[]; weight: number[] } {
  const byBone = new Map<number, number>();
  for (let c = 0; c < 3; c += 1) {
    const vertex = point.corners[c]!;
    const share = point.weights[c]!;
    for (let k = 0; k < 4; k += 1) {
      const weight = weights[vertex * 4 + k]! * share;
      if (weight > 0) {
        const bone = indices[vertex * 4 + k]!;
        byBone.set(bone, (byBone.get(bone) ?? 0) + weight);
      }
    }
  }
  const top = [...byBone].sort((x, y) => y[1] - x[1]).slice(0, 4);
  const total = top.reduce((sum, [, weight]) => sum + weight, 0) || 1;
  const index = [0, 0, 0, 0];
  const weight = [0, 0, 0, 0];
  top.forEach(([bone, w], k) => {
    index[k] = bone;
    weight[k] = w / total;
  });
  return { index, weight };
}

/**
 * The skin's leg triangles between two heights, bucketed across the floor, and
 * where a horizontal line through them meets the skin.
 */
class SkinBand {
  private readonly cells = new Map<string, number[]>();
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly c = new Vector3();
  private readonly e1 = new Vector3();
  private readonly e2 = new Vector3();
  private readonly p = new Vector3();
  private readonly q = new Vector3();
  private readonly s = new Vector3();
  private readonly n = new Vector3();
  private readonly t2 = new Vector2();

  constructor(
    private readonly position: Attribute,
    private readonly normal: Attribute,
    private readonly uv: Attribute,
    private readonly triangles: readonly (readonly [number, number, number])[],
  ) {
    triangles.forEach((corners, t) => {
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const v of corners) {
        minX = Math.min(minX, position.getX(v));
        maxX = Math.max(maxX, position.getX(v));
        minZ = Math.min(minZ, position.getZ(v));
        maxZ = Math.max(maxZ, position.getZ(v));
      }
      for (let i = Math.floor(minX / CELL); i <= Math.floor(maxX / CELL); i += 1) {
        for (let k = Math.floor(minZ / CELL); k <= Math.floor(maxZ / CELL); k += 1) {
          const key = `${i},${k}`;
          const cell = this.cells.get(key);
          if (cell) cell.push(t);
          else this.cells.set(key, [t]);
        }
      }
    });
  }

  /**
   * The skin nearest to `origin` along the line through it in `direction`
   * (within REACH either way), facing that way and on the UV island of `near`;
   * null where there is none.
   */
  hit(origin: Vector3, direction: Vector3, near: Vector2): SurfacePoint | null {
    const seen = new Set<number>();
    let best: SurfacePoint | null = null;
    let nearest = REACH;
    const x0 = Math.floor((origin.x - REACH) / CELL);
    const x1 = Math.floor((origin.x + REACH) / CELL);
    const z0 = Math.floor((origin.z - REACH) / CELL);
    const z1 = Math.floor((origin.z + REACH) / CELL);
    for (let i = x0; i <= x1; i += 1) {
      for (let k = z0; k <= z1; k += 1) {
        for (const t of this.cells.get(`${i},${k}`) ?? []) {
          if (seen.has(t)) continue;
          seen.add(t);
          const corners = this.triangles[t]!;
          const found = this.intersect(origin, direction, corners);
          if (!found || Math.abs(found.t) >= nearest) continue;
          const point = { corners, weights: found.weights };
          // The leg's outside, not the far wall seen from within.
          if (sample3(this.normal, point, this.n).dot(direction) <= 0) continue;
          if (sample2(this.uv, point, this.t2).distanceTo(near) > UV_REACH) continue;
          nearest = Math.abs(found.t);
          best = point;
        }
      }
    }
    return best;
  }

  /** Möller-Trumbore on the whole line, not just the ray. */
  private intersect(
    origin: Vector3,
    direction: Vector3,
    corners: readonly [number, number, number],
  ): { t: number; weights: [number, number, number] } | null {
    const { a, b, c, e1, e2, p, q, s } = this;
    a.fromBufferAttribute(this.position, corners[0]);
    b.fromBufferAttribute(this.position, corners[1]);
    c.fromBufferAttribute(this.position, corners[2]);
    e1.subVectors(b, a);
    e2.subVectors(c, a);
    p.crossVectors(direction, e2);
    const det = e1.dot(p);
    if (Math.abs(det) < 1e-14) return null;
    const inverse = 1 / det;
    s.subVectors(origin, a);
    const u = s.dot(p) * inverse;
    if (u < -1e-6 || u > 1 + 1e-6) return null;
    q.crossVectors(s, e1);
    const v = direction.dot(q) * inverse;
    if (v < -1e-6 || u + v > 1 + 1e-6) return null;
    return { t: e2.dot(q) * inverse, weights: [1 - u - v, u, v] };
  }
}

/**
 * The cuff ring for an edge at rest height `top` on a body geometry with the
 * LEG_HEIGHT attribute, or null where no triangle crosses it. Up is +y (bind
 * pose): the legs and the waist stand upright.
 */
export function cuffGeometry(
  body: BufferGeometry,
  top: number,
  profile: CuffProfile,
): BufferGeometry | null {
  const heightAttribute = body.getAttribute(LEG_HEIGHT);
  const position = body.getAttribute('position');
  const normal = body.getAttribute('normal');
  const uv = body.getAttribute('uv');
  const skinIndex = body.getAttribute('skinIndex');
  const skinWeight = body.getAttribute('skinWeight');
  const index = body.getIndex();
  if (!heightAttribute || !position || !normal || !uv || !skinIndex || !skinWeight || !index) {
    return null;
  }
  const heights = heightAttribute.array;
  const hidden = body.getAttribute(BODY_HIDDEN)?.array;
  const lowest = top + Math.min(...profile.points.map(([, up]) => up));

  // The triangles the edge crosses, each with the edge as two points on it, and
  // the leg's triangles the lower rows can sit on.
  const segments: [SurfacePoint, SurfacePoint][] = [];
  const band: (readonly [number, number, number])[] = [];
  for (let f = 0; f < index.count; f += 3) {
    const corners = [index.getX(f), index.getX(f + 1), index.getX(f + 2)] as const;
    const h = corners.map((v) => heights[v]!);
    if (h.some((value) => value >= ARM_HEIGHT / 2)) continue;
    if (Math.min(...h) <= top + 0.001 && Math.max(...h) >= lowest - 0.002) band.push(corners);
    const crossings: SurfacePoint[] = [];
    for (let e = 0; e < 3; e += 1) {
      const ha = h[e]!;
      const hb = h[(e + 1) % 3]!;
      if (ha < top === hb < top) continue;
      const t = (top - ha) / (hb - ha);
      const weights: [number, number, number] = [0, 0, 0];
      weights[e] = 1 - t;
      weights[(e + 1) % 3] = t;
      crossings.push({ corners, weights });
    }
    if (crossings.length === 2) segments.push([crossings[0]!, crossings[1]!]);
  }
  if (segments.length === 0) return null;
  const skin = new SkinBand(position, normal, uv, band);

  const rows = profile.points.length;
  const columns = COLUMNS + 1;
  const count = segments.length * columns * rows;
  const out = {
    position: new Float32Array(count * 3),
    normal: new Float32Array(count * 3),
    uv: new Float32Array(count * 2),
    skinIndex: new Uint16Array(count * 4),
    skinWeight: new Float32Array(count * 4),
    legHeight: new Float32Array(count),
    hidden: new Float32Array(count),
  };
  const morphPositions = body.morphAttributes.position ?? [];
  const morphNormals = body.morphAttributes.normal ?? [];
  const morphs = {
    position: morphPositions.map(() => new Float32Array(count * 3)),
    normal: morphNormals.map(() => new Float32Array(count * 3)),
  };
  // The profile's normals in its own plane (outward, up), from its tangents.
  const profileNormals = profile.points.map((_, j) => {
    const prev = profile.points[Math.max(j - 1, 0)]!;
    const next = profile.points[Math.min(j + 1, rows - 1)]!;
    const dOut = next[0] - prev[0];
    const dUp = next[1] - prev[1];
    const length = Math.hypot(dOut, dUp) || 1;
    // Walking down the profile, outward is the tangent turned a quarter towards +out.
    return [-dUp / length, dOut / length] as const;
  });

  const up = new Vector3(0, 1, 0);
  const p = new Vector3();
  const n = new Vector3();
  const along = new Vector3();
  const across = new Vector3();
  const origin = new Vector3();
  const at = new Vector3();
  const t2 = new Vector2();
  const edgeUv = new Vector2();
  const morph = new Vector3();
  /** The skin's normal and its "up the leg" tangent at a point. */
  const frame = (point: SurfacePoint) => {
    sample3(normal, point, n).normalize();
    along.copy(up).addScaledVector(n, -n.dot(up));
    if (along.lengthSq() < 1e-12) along.copy(up);
    along.normalize();
  };

  let vertex = 0;
  const indices: number[] = [];
  const e1 = new Vector3();
  const e2 = new Vector3();
  const face = new Vector3();
  const corner = (k: number) => new Vector3().fromArray(out.position, k * 3);
  for (const [from, to] of segments) {
    const first = vertex;
    // Each row sits on the edge's own triangle above the edge, on the skin at its
    // height below it; the attributes come from wherever it sits.
    const placed: {
      point: SurfacePoint;
      out: number;
      up: number;
      j: number;
    }[] = [];
    for (let c = 0; c < columns; c += 1) {
      const s = c / COLUMNS;
      const edge: SurfacePoint = {
        corners: from.corners,
        weights: [0, 1, 2].map((k) => lerp(from.weights[k]!, to.weights[k]!, s)) as [
          number,
          number,
          number,
        ],
      };
      sample3(position, edge, p);
      sample2(uv, edge, edgeUv);
      frame(edge);
      // Across the leg, level: where a lower row looks for the skin.
      across.copy(n).addScaledVector(up, -n.dot(up));
      if (across.lengthSq() < 1e-12) across.copy(n);
      across.normalize();
      profile.points.forEach(([offOut, offUp], j) => {
        const lower =
          offUp < 0 ? skin.hit(origin.copy(p).addScaledVector(up, offUp), across, edgeUv) : null;
        placed.push({
          point: lower ?? edge,
          out: offOut,
          up: lower ? 0 : offUp,
          j,
        });
      });
    }
    // Hidden where any skin it sits on is: a garment's mask stops short of its edge,
    // and the cuff stands off the skin into the cloth.
    let hide = 0;
    if (hidden) {
      for (const { point } of placed) {
        for (const v of point.corners) hide = Math.max(hide, hidden[v]!);
      }
    }
    for (const { point, out: offOut, up: offUp, j } of placed) {
      const [nOut, nUp] = profileNormals[j]!;
      frame(point);
      sample3(position, point, at).addScaledVector(n, offOut).addScaledVector(along, offUp);
      out.position.set([at.x, at.y, at.z], vertex * 3);
      at.copy(n).multiplyScalar(nOut).addScaledVector(along, nUp).normalize();
      out.normal.set([at.x, at.y, at.z], vertex * 3);
      sample2(uv, point, t2);
      out.uv.set([t2.x, t2.y + offUp * UV_PER_METRE], vertex * 2);
      const { index: bones, weight } = blendInfluences(skinIndex.array, skinWeight.array, point);
      out.skinIndex.set(bones, vertex * 4);
      out.skinWeight.set(weight, vertex * 4);
      // All of it under the edge: drawn as sock, the rim's light on its top.
      out.legHeight[vertex] = top - 0.002 + Math.min(profile.points[j]![1], 0);
      out.hidden[vertex] = hide;
      morphPositions.forEach((attribute, m) => {
        sample3(attribute, point, morph).toArray(morphs.position[m]!, vertex * 3);
      });
      morphNormals.forEach((attribute, m) => {
        sample3(attribute, point, morph).toArray(morphs.normal[m]!, vertex * 3);
      });
      vertex += 1;
    }
    for (let c = 0; c < COLUMNS; c += 1) {
      const s = first + c * rows;
      const e = s + rows;
      for (let j = 0; j < rows - 1; j += 1) {
        let quad = [s + j, e + j, e + j + 1, s + j + 1];
        // Wind each quad to face along its profile normal.
        e1.subVectors(corner(quad[1]!), corner(quad[0]!));
        e2.subVectors(corner(quad[3]!), corner(quad[0]!));
        face.crossVectors(e1, e2);
        n.fromArray(out.normal, quad[0]! * 3);
        if (face.dot(n) < 0) quad = [quad[0]!, quad[3]!, quad[2]!, quad[1]!];
        indices.push(quad[0]!, quad[1]!, quad[2]!, quad[0]!, quad[2]!, quad[3]!);
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(out.position, 3));
  geometry.setAttribute('normal', new BufferAttribute(out.normal, 3));
  geometry.setAttribute('uv', new BufferAttribute(out.uv, 2));
  geometry.setAttribute('skinIndex', new BufferAttribute(out.skinIndex, 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(out.skinWeight, 4));
  geometry.setAttribute(LEG_HEIGHT, new BufferAttribute(out.legHeight, 1));
  geometry.setAttribute(TOE_WEIGHT, new BufferAttribute(new Float32Array(count), 1));
  geometry.setAttribute(BODY_HIDDEN, new BufferAttribute(out.hidden, 1));
  if (morphs.position.length > 0) {
    geometry.morphAttributes.position = morphs.position.map(
      (array) => new BufferAttribute(array, 3),
    );
    if (morphs.normal.length === morphs.position.length) {
      geometry.morphAttributes.normal = morphs.normal.map((array) => new BufferAttribute(array, 3));
    }
    geometry.morphTargetsRelative = body.morphTargetsRelative;
  }
  geometry.setIndex(indices);
  return geometry;
}
/**
 * The cuff as a mesh on the body: its skeleton, its morph weights (shared, so
 * body sliders move it as they move the leg) and its skin material. The body's
 * bind matrix changes whenever the sliders rebind it; the cuff follows on every
 * render.
 */
export function wearCuff(body: SkinnedMesh, wear: SockWear, parent: Object3D): SkinnedMesh | null {
  const geometry = cuffGeometry(body.geometry, wear.top, cuffProfile(wear.fabric, wear.cuff));
  if (!geometry) return null;
  const cuff = new SkinnedMesh(geometry, body.material as Material);
  cuff.name = 'sock_cuff';
  cuff.morphTargetInfluences = body.morphTargetInfluences;
  cuff.morphTargetDictionary = body.morphTargetDictionary;
  cuff.bind(body.skeleton, body.bindMatrix);
  cuff.castShadow = true;
  cuff.receiveShadow = true;
  cuff.frustumCulled = false;
  cuff.customDepthMaterial = body.customDepthMaterial;
  cuff.onBeforeRender = () => {
    cuff.bindMatrix.copy(body.bindMatrix);
    cuff.bindMatrixInverse.copy(body.bindMatrixInverse);
  };
  parent.add(cuff);
  return cuff;
}

/** Takes a cuff off its body. */
export function takeOffCuff(cuff: SkinnedMesh | null): void {
  if (!cuff) return;
  cuff.removeFromParent();
  cuff.geometry.dispose();
}
