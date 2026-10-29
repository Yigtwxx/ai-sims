import {
  BufferAttribute,
  BufferGeometry,
  SkinnedMesh,
  Vector3,
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
 * sock. It takes every attribute from those triangles (UVs, skin weights, body
 * slider morphs, the mask of skin under garments) and wears the body's skin
 * material, so it is the same knit in the same light, hidden with the skin.
 */

/** Cross-section of the cuff: outward offset and height from the edge (m), top first. */
export interface CuffProfile {
  points: readonly (readonly [out: number, up: number])[];
}

const UV_PER_METRE = 0.65;

/** The cuff of each fabric: a rolled knit band, or the flat waistband of tights. */
export function cuffProfile(fabric: SockFabric, depth: number): CuffProfile {
  const thick = fabric === 'nylon' ? 0.0009 : 0.0021;
  const band = Math.min(depth * 0.4, fabric === 'nylon' ? 0.012 : 0.006);
  return {
    points: [
      [0.0002, 0.0003],
      [thick * 0.7, 0.0004],
      [thick, -0.0006],
      [thick * 0.95, -band],
      [0.0003, -depth],
    ],
  };
}

interface Crossing {
  a: number;
  b: number;
  t: number;
}

const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

/** Up to four strongest bone influences of two blended vertices. */
function blendInfluences(
  indices: ArrayLike<number>,
  weights: ArrayLike<number>,
  a: number,
  b: number,
  t: number,
): { index: number[]; weight: number[] } {
  const byBone = new Map<number, number>();
  for (const [vertex, share] of [
    [a, 1 - t],
    [b, t],
  ] as const) {
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
  const segments: [Crossing, Crossing, number][] = [];
  for (let f = 0; f < index.count; f += 3) {
    const corners = [index.getX(f), index.getX(f + 1), index.getX(f + 2)];
    const h = corners.map((v) => heights[v]!);
    if (h.some((value) => value >= ARM_HEIGHT / 2)) continue;
    const crossings: Crossing[] = [];
    for (let e = 0; e < 3; e += 1) {
      const a = corners[e]!;
      const b = corners[(e + 1) % 3]!;
      const ha = heights[a]!;
      const hb = heights[b]!;
      if (ha < top !== hb < top) crossings.push({ a, b, t: (top - ha) / (hb - ha) });
    }
    if (crossings.length === 2) segments.push([crossings[0]!, crossings[1]!, f]);
  }
  if (segments.length === 0) return null;

  const rows = profile.points.length;
  const count = segments.length * 2 * rows;
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

  const p = new Vector3();
  const n = new Vector3();
  const outward = new Vector3();
  const up = new Vector3(0, 1, 0);
  const indices: number[] = [];
  let vertex = 0;
  const writeCrossing = (crossing: Crossing, hide: number) => {
    const { a, b, t } = crossing;
    p.set(
      lerp(position.getX(a), position.getX(b), t),
      lerp(position.getY(a), position.getY(b), t),
      lerp(position.getZ(a), position.getZ(b), t),
    );
    n.set(
      lerp(normal.getX(a), normal.getX(b), t),
      lerp(normal.getY(a), normal.getY(b), t),
      lerp(normal.getZ(a), normal.getZ(b), t),
    );
    // Outward across the leg: the normal without its upward part.
    outward.copy(n).addScaledVector(up, -n.dot(up));
    if (outward.lengthSq() < 1e-12) outward.copy(n);
    outward.normalize();
    const u = lerp(uv.getX(a), uv.getX(b), t);
    const v = lerp(uv.getY(a), uv.getY(b), t);
    const { index: bones, weight } = blendInfluences(skinIndex.array, skinWeight.array, a, b, t);
    const first = vertex;
    profile.points.forEach(([offOut, offUp], j) => {
      const [nOut, nUp] = profileNormals[j]!;
      out.position.set(
        [
          p.x + outward.x * offOut + up.x * offUp,
          p.y + outward.y * offOut + up.y * offUp,
          p.z + outward.z * offOut + up.z * offUp,
        ],
        vertex * 3,
      );
      out.normal.set(
        [
          outward.x * nOut + up.x * nUp,
          outward.y * nOut + up.y * nUp,
          outward.z * nOut + up.z * nUp,
        ],
        vertex * 3,
      );
      out.uv.set([u, v + offUp * UV_PER_METRE], vertex * 2);
      out.skinIndex.set(bones, vertex * 4);
      out.skinWeight.set(weight, vertex * 4);
      // All of it under the edge: drawn as sock, the rim's light on its top.
      out.legHeight[vertex] = top - 0.002 + Math.min(offUp, 0);
      out.hidden[vertex] = hide;
      morphPositions.forEach((attribute, m) => {
        morphs.position[m]!.set(
          [
            lerp(attribute.getX(a), attribute.getX(b), t),
            lerp(attribute.getY(a), attribute.getY(b), t),
            lerp(attribute.getZ(a), attribute.getZ(b), t),
          ],
          vertex * 3,
        );
      });
      morphNormals.forEach((attribute, m) => {
        morphs.normal[m]!.set(
          [
            lerp(attribute.getX(a), attribute.getX(b), t),
            lerp(attribute.getY(a), attribute.getY(b), t),
            lerp(attribute.getZ(a), attribute.getZ(b), t),
          ],
          vertex * 3,
        );
      });
      vertex += 1;
    });
    return first;
  };

  const e1 = new Vector3();
  const e2 = new Vector3();
  const face = new Vector3();
  for (const [from, to, f] of segments) {
    // Hidden where any corner of its triangle is: a garment's mask stops short of its
    // edge, and the cuff stands off the skin into the cloth.
    const hide = hidden
      ? Math.max(hidden[index.getX(f)]!, hidden[index.getX(f + 1)]!, hidden[index.getX(f + 2)]!)
      : 0;
    const s = writeCrossing(from, hide);
    const e = writeCrossing(to, hide);
    for (let j = 0; j < rows - 1; j += 1) {
      let quad = [s + j, e + j, e + j + 1, s + j + 1];
      // Wind each quad to face along its profile normal.
      const at = (k: number) => new Vector3().fromArray(out.position, quad[k]! * 3);
      e1.subVectors(at(1), at(0));
      e2.subVectors(at(3), at(0));
      face.crossVectors(e1, e2);
      n.fromArray(out.normal, quad[0]! * 3);
      if (face.dot(n) < 0) quad = [quad[0]!, quad[3]!, quad[2]!, quad[1]!];
      indices.push(quad[0]!, quad[1]!, quad[2]!, quad[0]!, quad[2]!, quad[3]!);
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
