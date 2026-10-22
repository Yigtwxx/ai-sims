import {
  BufferAttribute,
  Matrix4,
  type Bone,
  type BufferGeometry,
  type InterleavedBufferAttribute,
  type SkinnedMesh,
} from 'three';

import type { BodyRig, NeckSeamBinding } from './assembly';

/**
 * Outfit garments on a body (contract: docs/specs/2026-10-20-metahuman-web-assets.md,
 * "Outfit GLBs"). A garment is fitted to the neutral body in its bind space and
 * carries the body's slider morphs, so it shares the body's skeleton object:
 * its skin indices are remapped to the body's joint order once, and from then
 * on every rebind of the body (sliders) moves the garment's inverse binds too.
 */

type Attribute = BufferAttribute | InterleavedBufferAttribute;

/** Per-vertex body attribute: 1 where a worn garment covers the skin closely. */
export const BODY_HIDDEN = 'bodyHidden';

/**
 * Rewrites a garment's skin indices from its own joint order to the body
 * skeleton's and binds it to that skeleton. Joints the body lacks fall back to
 * their nearest ancestor the body has. Returns the joints that had to fall back.
 */
export function bindGarment(garment: SkinnedMesh, body: BodyRig): string[] {
  const bodyBones = body.mesh.skeleton.bones;
  const bodyIndex = new Map(bodyBones.map((bone, i) => [bone.name, i]));
  const fallbacks: string[] = [];
  const remap = garment.skeleton.bones.map((bone) => {
    let node: typeof bone | null = bone;
    while (node && !bodyIndex.has(node.name)) node = node.parent as typeof bone | null;
    if (node !== bone) fallbacks.push(bone.name);
    return node ? bodyIndex.get(node.name)! : 0;
  });
  const index = garment.geometry.getAttribute('skinIndex') as Attribute;
  const remapped = new BufferAttribute(new Uint16Array(index.count * 4), 4);
  for (let v = 0; v < index.count; v += 1) {
    for (let k = 0; k < 4; k += 1) remapped.setComponent(v, k, remap[index.getComponent(v, k)]!);
  }
  garment.geometry.setAttribute('skinIndex', remapped);
  garment.bind(body.mesh.skeleton, body.mesh.bindMatrix);
  garment.frustumCulled = false;
  return fallbacks;
}

/** Gives a garment the body's current slider morph weights (matched by name). */
export function syncGarmentMorphs(garment: SkinnedMesh, body: BodyRig): void {
  const source = body.mesh.morphTargetDictionary ?? {};
  const weights = body.mesh.morphTargetInfluences ?? [];
  const target = garment.morphTargetDictionary ?? {};
  const influences = garment.morphTargetInfluences;
  if (!influences) return;
  for (const [name, i] of Object.entries(target)) {
    const j = source[name];
    influences[i] = j === undefined ? 0 : (weights[j] ?? 0);
  }
}

/** Decodes a base64 bitset (bit v of byte v >> 3, LSB first) into one flag per vertex. */
export function decodeHideBitset(base64: string, count: number): Uint8Array {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const flags = new Uint8Array(count);
  for (let v = 0; v < count; v += 1) flags[v] = (bytes[v >> 3]! >> (v & 7)) & 1;
  return flags;
}

/** The character whose clothes a shared body geometry's mask shows (see applyBodyHide). */
const hideOwners = new WeakMap<BufferGeometry, SkinnedMesh>();

/**
 * Hides the skin under every worn garment: the union of their masks becomes
 * the body's BODY_HIDDEN attribute, which the body skin shader discards on.
 * Characters built from one body GLB share its geometry and so this mask: the
 * character that set it last owns it (see releaseBodyHide).
 */
export function applyBodyHide(body: SkinnedMesh, masks: readonly Uint8Array[]): void {
  const count = (body.geometry.getAttribute('position') as Attribute).count;
  const hidden = new Float32Array(count);
  for (const mask of masks) {
    if (mask.length !== count) continue;
    for (let v = 0; v < count; v += 1) if (mask[v]) hidden[v] = 1;
  }
  body.geometry.setAttribute(BODY_HIDDEN, new BufferAttribute(hidden, 1));
  hideOwners.set(body.geometry, body);
}

/**
 * Clears the mask when a character takes its clothes off on teardown, unless
 * another character has set it since. A face change dresses the new character
 * before the old one unmounts; clearing then left the new one's skin showing
 * through its clothes.
 */
export function releaseBodyHide(body: SkinnedMesh): void {
  if (hideOwners.get(body.geometry) === body) applyBodyHide(body, []);
}

/** Garment vertices farther than this (m) from the head skin keep their weights. */
const HEAD_REACH = 0.03;
/** Head vertices whose skin is blended into one garment vertex. */
const HEAD_NEIGHBOURS = 4;
/**
 * Width (m) of the blend: a garment vertex takes the head's skin fully once it
 * is this much closer to the head skin than to the body skin, and none at all
 * while the body skin is at least as close.
 */
const HEAD_BAND = 0.015;
/** Points per k-d tree leaf. */
const LEAF = 8;
/** Clearance (m) a garment keeps over the head skin under it (see fitGarmentOverHead). */
const HEAD_CLEARANCE = 0.003;

type Vec3Array = [number, number, number];

/**
 * Implicit k-d tree: node [lo, hi) splits at its median slot m = (lo + hi) >> 1
 * on `axis[m]`; ranges of at most LEAF points are leaves.
 */
interface PointTree {
  points: Float32Array;
  order: Int32Array;
  axis: Uint8Array;
}

/** Reorders order[lo, hi) so that slot m holds its median along `axis`. */
function selectMedian(
  points: Float32Array,
  order: Int32Array,
  lo: number,
  hi: number,
  m: number,
  axis: number,
) {
  let left = lo;
  let right = hi - 1;
  while (left < right) {
    const pivot = points[order[(left + right) >> 1]! * 3 + axis]!;
    let i = left;
    let j = right;
    while (i <= j) {
      while (points[order[i]! * 3 + axis]! < pivot) i += 1;
      while (points[order[j]! * 3 + axis]! > pivot) j -= 1;
      if (i <= j) {
        const swap = order[i]!;
        order[i] = order[j]!;
        order[j] = swap;
        i += 1;
        j -= 1;
      }
    }
    if (m <= j) right = j;
    else if (m >= i) left = i;
    else return;
  }
}

function buildTree(points: Float32Array): PointTree {
  const count = points.length / 3;
  const order = new Int32Array(count);
  for (let p = 0; p < count; p += 1) order[p] = p;
  const axis = new Uint8Array(count);
  const split = (lo: number, hi: number) => {
    if (hi - lo <= LEAF) return;
    // Split along the widest extent of the range.
    const low = [Infinity, Infinity, Infinity];
    const high = [-Infinity, -Infinity, -Infinity];
    for (let s = lo; s < hi; s += 1) {
      for (let a = 0; a < 3; a += 1) {
        const value = points[order[s]! * 3 + a]!;
        if (value < low[a]!) low[a] = value;
        if (value > high[a]!) high[a] = value;
      }
    }
    const spans = [0, 1, 2].map((a) => high[a]! - low[a]!);
    const a = spans[0]! >= spans[1]! && spans[0]! >= spans[2]! ? 0 : spans[1]! >= spans[2]! ? 1 : 2;
    const m = (lo + hi) >> 1;
    selectMedian(points, order, lo, hi, m, a);
    axis[m] = a;
    split(lo, m);
    split(m + 1, hi);
  };
  split(0, count);
  return { points, order, axis };
}

/** Tree walk stack: (lo, hi, lower bound of the squared distance) per pending range. */
const walk = new Float64Array(3 * 256);

/** Inserts squared distance d of point p into the sorted k best; returns the new count. */
function insertNearest(
  d: number,
  p: number,
  k: number,
  found: number,
  outIndex: Int32Array,
  outDistance: Float64Array,
): number {
  let at = found === k ? k - 1 : found;
  while (at > 0 && outDistance[at - 1]! > d) {
    outDistance[at] = outDistance[at - 1]!;
    outIndex[at] = outIndex[at - 1]!;
    at -= 1;
  }
  outDistance[at] = d;
  outIndex[at] = p;
  return found === k ? k : found + 1;
}

/**
 * The k nearest tree points within `reach` of (x, y, z), nearest first, in
 * `outIndex`/`outDistance`; returns how many were found.
 */
function nearestPoints(
  tree: PointTree,
  x: number,
  y: number,
  z: number,
  k: number,
  reach: number,
  outIndex: Int32Array,
  outDistance: Float64Array,
): number {
  const { points, order, axis } = tree;
  const limit = reach * reach;
  let found = 0;
  let worst = limit;
  let top = 0;
  if (order.length > 0) {
    walk[0] = 0;
    walk[1] = order.length;
    walk[2] = 0;
    top = 1;
  }
  while (top > 0) {
    top -= 1;
    const lo = walk[top * 3]!;
    const hi = walk[top * 3 + 1]!;
    const bound = walk[top * 3 + 2]!;
    if (bound > worst) continue;
    const leaf = hi - lo <= LEAF;
    const m = (lo + hi) >> 1;
    // A leaf checks all its points; a node its median, then queues both halves.
    for (let s = leaf ? lo : m; s < (leaf ? hi : m + 1); s += 1) {
      const p = order[s]!;
      const dx = points[p * 3]! - x;
      const dy = points[p * 3 + 1]! - y;
      const dz = points[p * 3 + 2]! - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d > worst) continue;
      found = insertNearest(d, p, k, found, outIndex, outDistance);
      if (found === k) worst = Math.min(limit, outDistance[k - 1]!);
    }
    if (leaf) continue;
    const a = axis[m]!;
    const offset = (a === 0 ? x : a === 1 ? y : z) - points[order[m]! * 3 + a]!;
    const far = Math.max(bound, offset * offset);
    // Far half below the near one on the stack, so the near half is walked first.
    const nearLo = offset < 0 ? lo : m + 1;
    const nearHi = offset < 0 ? m : hi;
    const farLo = offset < 0 ? m + 1 : lo;
    const farHi = offset < 0 ? hi : m;
    if (farLo < farHi) {
      walk[top * 3] = farLo;
      walk[top * 3 + 1] = farHi;
      walk[top * 3 + 2] = far;
      top += 1;
    }
    if (nearLo < nearHi) {
      walk[top * 3] = nearLo;
      walk[top * 3 + 1] = nearHi;
      walk[top * 3 + 2] = bound;
      top += 1;
    }
  }
  for (let n = 0; n < found; n += 1) outDistance[n] = Math.sqrt(outDistance[n]!);
  return found;
}

interface ActiveMorph {
  morph: Attribute;
  weight: number;
}

/** A mesh's nonzero morphs, to place its vertices as the sliders have them. */
function activeMorphs(mesh: SkinnedMesh): ActiveMorph[] {
  const morphs = mesh.geometry.morphAttributes.position ?? [];
  const influences = mesh.morphTargetInfluences ?? [];
  return morphs.flatMap((morph, m) => {
    const weight = influences[m] ?? 0;
    return weight !== 0 ? [{ morph: morph as Attribute, weight }] : [];
  });
}

/** Bind-frame position of vertex v (morphs applied), written to out[0..2]. */
function bindPoint(
  mesh: SkinnedMesh,
  morphs: readonly ActiveMorph[],
  v: number,
  out: Float32Array,
): void {
  const position = mesh.geometry.getAttribute('position') as Attribute;
  const bx = position.getX(v);
  const by = position.getY(v);
  const bz = position.getZ(v);
  let x = bx;
  let y = by;
  let z = bz;
  const relative = mesh.geometry.morphTargetsRelative;
  for (const { morph, weight } of morphs) {
    x += weight * (morph.getX(v) - (relative ? 0 : bx));
    y += weight * (morph.getY(v) - (relative ? 0 : by));
    z += weight * (morph.getZ(v) - (relative ? 0 : bz));
  }
  const e = mesh.bindMatrix.elements;
  out[0] = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
  out[1] = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
  out[2] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
}

function withinBox(point: Float32Array, lo: Vec3Array, hi: Vec3Array, margin: number): boolean {
  for (let a = 0; a < 3; a += 1)
    if (point[a]! < lo[a] - margin || point[a]! > hi[a] + margin) return false;
  return true;
}

/** Head and body skin of one character in the body's bind frame, ready to search. */
interface SkinSpace {
  /** Changes whenever the body is rebound or its slider morphs move. */
  signature: number;
  /** Head skeleton slot -> body joint, -1 when it has none. */
  jointOf: Int32Array;
  headTree: PointTree;
  /** Outward unit normal of each head skin point (the tree's point order), or null. */
  headNormals: Float32Array | null;
  bodyTree: PointTree;
  lo: Vec3Array;
  hi: Vec3Array;
}

/** One per character (its seam), reused by every outfit it puts on until the sliders move. */
const skinSpaces = new WeakMap<NeckSeamBinding, SkinSpace>();

function bindSignature(body: SkinnedMesh): number {
  let signature = 0;
  body.skeleton.boneInverses.forEach((inverse, i) => {
    const e = inverse.elements;
    signature += (i + 1) * (e[12]! + 3 * e[13]! + 7 * e[14]! + e[0]! + e[5]! + e[10]!);
  });
  for (const e of body.bindMatrix.elements) signature = signature * 1.000001 + e;
  for (const w of body.morphTargetInfluences ?? []) signature = signature * 1.000003 + w;
  return signature;
}

function skinSpace(seam: NeckSeamBinding): SkinSpace {
  const { head, body } = seam;
  const signature = bindSignature(body);
  const cached = skinSpaces.get(seam);
  if (cached && cached.signature === signature) return cached;

  // Head skeleton slot -> body joint and its bind-frame skin matrix. Face bones
  // the body lacks skin with the body bone they hang under, offset from it as
  // they are now.
  const bodyJoint = new Map(body.skeleton.bones.map((bone, joint) => [bone, joint]));
  const headBones = head.skeleton.bones;
  const jointOf = new Int32Array(headBones.length).fill(-1);
  const bindOf: (Matrix4 | undefined)[] = new Array<Matrix4 | undefined>(headBones.length);
  const relative = new Matrix4();
  headBones.forEach((bone, slot) => {
    let node: Bone | null = bone;
    while (node && !bodyJoint.has(node)) node = node.parent as Bone | null;
    if (!node) return;
    const joint = bodyJoint.get(node)!;
    const matrix = new Matrix4().copy(body.skeleton.boneInverses[joint]!).invert();
    if (node !== bone)
      matrix.multiply(relative.copy(node.matrixWorld).invert().multiply(bone.matrixWorld));
    bindOf[slot] = matrix.multiply(head.skeleton.boneInverses[slot]!).multiply(head.bindMatrix);
    jointOf[slot] = joint;
  });

  const headPosition = head.geometry.getAttribute('position') as Attribute;
  const headNormal = head.geometry.getAttribute('normal') as Attribute | undefined;
  const headIndex = head.geometry.getAttribute('skinIndex') as Attribute;
  const headWeight = head.geometry.getAttribute('skinWeight') as Attribute;
  const headPoints = new Float32Array(headPosition.count * 3);
  const headNormals = headNormal ? new Float32Array(headPosition.count * 3) : null;
  const lo: Vec3Array = [Infinity, Infinity, Infinity];
  const hi: Vec3Array = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < headPosition.count; v += 1) {
    const px = headPosition.getX(v);
    const py = headPosition.getY(v);
    const pz = headPosition.getZ(v);
    let total = 0;
    for (let c = 0; c < 4; c += 1) {
      const w = headWeight.getComponent(v, c);
      const e = w > 0 ? bindOf[headIndex.getComponent(v, c)]?.elements : undefined;
      if (!e) continue;
      headPoints[v * 3]! += w * (e[0]! * px + e[4]! * py + e[8]! * pz + e[12]!);
      headPoints[v * 3 + 1]! += w * (e[1]! * px + e[5]! * py + e[9]! * pz + e[13]!);
      headPoints[v * 3 + 2]! += w * (e[2]! * px + e[6]! * py + e[10]! * pz + e[14]!);
      if (headNormals && headNormal) {
        const nx = headNormal.getX(v);
        const ny = headNormal.getY(v);
        const nz = headNormal.getZ(v);
        headNormals[v * 3]! += w * (e[0]! * nx + e[4]! * ny + e[8]! * nz);
        headNormals[v * 3 + 1]! += w * (e[1]! * nx + e[5]! * ny + e[9]! * nz);
        headNormals[v * 3 + 2]! += w * (e[2]! * nx + e[6]! * ny + e[10]! * nz);
      }
      total += w;
    }
    if (headNormals) {
      const n = Math.hypot(headNormals[v * 3]!, headNormals[v * 3 + 1]!, headNormals[v * 3 + 2]!);
      for (let a = 0; a < 3; a += 1) headNormals[v * 3 + a]! /= n || 1;
    }
    for (let a = 0; a < 3; a += 1) {
      if (total > 0) headPoints[v * 3 + a]! /= total;
      lo[a] = Math.min(lo[a], headPoints[v * 3 + a]!);
      hi[a] = Math.max(hi[a], headPoints[v * 3 + a]!);
    }
  }

  // Body skin up to HEAD_REACH from any candidate (candidates: HEAD_REACH from the head).
  const margin = 2 * HEAD_REACH;
  const morphs = activeMorphs(body);
  const bodyCount = (body.geometry.getAttribute('position') as Attribute).count;
  const bodyPoints = new Float32Array(bodyCount * 3);
  const point = new Float32Array(3);
  let kept = 0;
  for (let v = 0; v < bodyCount; v += 1) {
    bindPoint(body, morphs, v, point);
    if (!withinBox(point, lo, hi, margin)) continue;
    bodyPoints.set(point, kept * 3);
    kept += 1;
  }

  const space: SkinSpace = {
    signature,
    jointOf,
    headTree: buildTree(headPoints),
    headNormals,
    bodyTree: buildTree(bodyPoints.slice(0, kept * 3)),
    lo,
    hi,
  };
  skinSpaces.set(seam, space);
  return space;
}

/** Skin being mixed for one vertex: joint and weight pairs, joints unique. */
class SkinMix {
  readonly joints = new Int32Array(24);
  readonly weights = new Float64Array(24);
  size = 0;

  add(joint: number, weight: number): void {
    for (let i = 0; i < this.size; i += 1) {
      if (this.joints[i] === joint) {
        this.weights[i]! += weight;
        return;
      }
    }
    if (this.size === this.joints.length) return;
    this.joints[this.size] = joint;
    this.weights[this.size] = weight;
    this.size += 1;
  }

  /** Keeps the 4 heaviest joints, heaviest first, renormalised; false when empty. */
  top4(): boolean {
    const n = Math.min(4, this.size);
    for (let i = 0; i < n; i += 1) {
      let best = i;
      for (let j = i + 1; j < this.size; j += 1)
        if (this.weights[j]! > this.weights[best]!) best = j;
      const joint = this.joints[i]!;
      const weight = this.weights[i]!;
      this.joints[i] = this.joints[best]!;
      this.weights[i] = this.weights[best]!;
      this.joints[best] = joint;
      this.weights[best] = weight;
    }
    this.size = n;
    let total = 0;
    for (let i = 0; i < n; i += 1) total += this.weights[i]!;
    if (total <= 0) return false;
    for (let i = 0; i < n; i += 1) this.weights[i]! /= total;
    return true;
  }
}

/**
 * Collar fix: re-skins the garment vertices that lie over the head's neck skin
 * from that skin instead of the body's.
 *
 * The converter transfers garment weights from the body only. A collar that
 * rises above the body's neck edge (crop tops, shirts) therefore carries the
 * clavicle and upper arm share of the nearest body vertex, while the head skin
 * right under it carries much less: when the arms move, collar and neck part
 * ways and the skin pokes through. Each such vertex takes the inverse-distance
 * blend of its nearest head vertices' skin instead, faded in over a small band
 * past the body edge so the weights stay continuous. Positions are compared in
 * the body's bind frame (slider morphs applied), so the pose playing right now
 * does not matter.
 *
 * Call after `bindGarment` and `syncGarmentMorphs` (the garment shares the body
 * skeleton). A garment that does not reach over the head skin keeps its
 * attributes as they are. Returns how many vertices changed.
 */
export function skinGarmentToHead(garment: SkinnedMesh, seam: NeckSeamBinding): number {
  if (garment.skeleton !== seam.body.skeleton) return 0;
  const { head } = seam;
  if ((head.geometry.getAttribute('position') as Attribute).count === 0) return 0;
  const { jointOf, headTree, bodyTree, lo, hi } = skinSpace(seam);
  const headIndex = head.geometry.getAttribute('skinIndex') as Attribute;
  const headWeight = head.geometry.getAttribute('skinWeight') as Attribute;

  const index = garment.geometry.getAttribute('skinIndex') as Attribute;
  const weight = garment.geometry.getAttribute('skinWeight') as Attribute;
  const morphs = activeMorphs(garment);
  const point = new Float32Array(3);
  const nearIndex = new Int32Array(HEAD_NEIGHBOURS);
  const nearDistance = new Float64Array(HEAD_NEIGHBOURS);
  const bodyNear = new Int32Array(1);
  const bodyDistance = new Float64Array(1);
  const fromHead = new SkinMix();
  const mixed = new SkinMix();
  let outIndex: Uint16Array | undefined;
  let outWeight: Float32Array | undefined;
  let changed = 0;

  for (let v = 0; v < index.count; v += 1) {
    bindPoint(garment, morphs, v, point);
    if (!withinBox(point, lo, hi, HEAD_REACH)) continue;
    const x = point[0]!;
    const y = point[1]!;
    const z = point[2]!;
    // Nearest body skin first; then only head skin nearer than that counts.
    const toBody = nearestPoints(bodyTree, x, y, z, 1, HEAD_REACH, bodyNear, bodyDistance)
      ? bodyDistance[0]!
      : HEAD_REACH;
    const found = nearestPoints(
      headTree,
      x,
      y,
      z,
      HEAD_NEIGHBOURS,
      toBody,
      nearIndex,
      nearDistance,
    );
    if (found === 0) continue;
    const t = Math.min(1, Math.max(0, (toBody - nearDistance[0]!) / HEAD_BAND));
    if (t === 0) continue;
    const blend = t * t * (3 - 2 * t);

    // Inverse-distance blend of the nearest head vertices' skin, in body joints.
    fromHead.size = 0;
    let headTotal = 0;
    for (let n = 0; n < found; n += 1) {
      const inverse = 1 / Math.max(nearDistance[n]!, 1e-5);
      const vertex = nearIndex[n]!;
      for (let c = 0; c < 4; c += 1) {
        const w = headWeight.getComponent(vertex, c);
        const joint = w > 0 ? jointOf[headIndex.getComponent(vertex, c)]! : -1;
        if (joint < 0) continue;
        fromHead.add(joint, inverse * w);
        headTotal += inverse * w;
      }
    }
    if (headTotal <= 0) continue;
    mixed.size = 0;
    let ownTotal = 0;
    for (let c = 0; c < 4; c += 1) ownTotal += Math.max(0, weight.getComponent(v, c));
    for (let c = 0; c < 4; c += 1) {
      const w = weight.getComponent(v, c);
      if (w > 0) mixed.add(index.getComponent(v, c), ((1 - blend) * w) / ownTotal);
    }
    for (let i = 0; i < fromHead.size; i += 1)
      mixed.add(fromHead.joints[i]!, (blend * fromHead.weights[i]!) / headTotal);
    if (!mixed.top4()) continue;

    if (!outIndex || !outWeight) {
      outIndex = new Uint16Array(index.count * 4);
      outWeight = new Float32Array(index.count * 4);
      for (let u = 0; u < index.count; u += 1) {
        for (let c = 0; c < 4; c += 1) {
          outIndex[u * 4 + c] = index.getComponent(u, c);
          outWeight[u * 4 + c] = weight.getComponent(u, c);
        }
      }
    }
    for (let c = 0; c < 4; c += 1) {
      outIndex[v * 4 + c] = c < mixed.size ? mixed.joints[c]! : 0;
      outWeight[v * 4 + c] = c < mixed.size ? mixed.weights[c]! : 0;
    }
    changed += 1;
  }

  if (outIndex && outWeight) {
    // Fresh attributes: never write into arrays another garment instance may share.
    garment.geometry.setAttribute('skinIndex', new BufferAttribute(outIndex, 4));
    garment.geometry.setAttribute('skinWeight', new BufferAttribute(outWeight, 4));
  }
  return changed;
}

/**
 * Collar fit: moves the garment off head skin that comes through it.
 *
 * Garments are fitted to the neutral body, but the neck above the body's edge
 * belongs to the head, and heads differ: a fuller or more forward neck (Isaiah,
 * Cameron) stood up to 1.5 cm in front of a crew neck and showed through it as
 * a skin-coloured hole, in every pose. Each head skin point the garment comes
 * within HEAD_CLEARANCE of (or passes behind) asks for the push that clears it
 * along its normal; every garment vertex near the head then moves by the
 * inverse-distance blend of what its nearest head points ask for, faded out
 * towards HEAD_REACH. Layers of one collar (an inner band under the outer one)
 * take the same push, so they keep their order. Bind frame, like
 * `skinGarmentToHead`; call after it. Returns how many vertices moved.
 */
export function fitGarmentOverHead(garment: SkinnedMesh, seam: NeckSeamBinding): number {
  if (garment.skeleton !== seam.body.skeleton) return 0;
  if ((seam.head.geometry.getAttribute('position') as Attribute).count === 0) return 0;
  const geometry = garment.geometry;
  // Relative morphs ride on the moved base positions; absolute ones would not.
  if ((geometry.morphAttributes.position?.length ?? 0) > 0 && !geometry.morphTargetsRelative) {
    return 0;
  }
  const { headTree, headNormals, lo, hi } = skinSpace(seam);
  if (!headNormals) return 0;

  const position = geometry.getAttribute('position') as Attribute;
  const morphs = activeMorphs(garment);
  const point = new Float32Array(3);
  const nearIndex = new Int32Array(HEAD_NEIGHBOURS);
  const nearDistance = new Float64Array(HEAD_NEIGHBOURS);
  const want = new Float32Array(headNormals.length / 3);
  const near: { v: number; index: Int32Array; distance: Float64Array }[] = [];

  // What each head point asks for: enough to clear the deepest garment vertex over it.
  for (let v = 0; v < position.count; v += 1) {
    bindPoint(garment, morphs, v, point);
    if (!withinBox(point, lo, hi, HEAD_REACH)) continue;
    const x = point[0]!;
    const y = point[1]!;
    const z = point[2]!;
    // Head skin under the body's edge counts too: near the seam both skins are close.
    const found = nearestPoints(
      headTree,
      x,
      y,
      z,
      HEAD_NEIGHBOURS,
      HEAD_REACH,
      nearIndex,
      nearDistance,
    );
    if (found === 0) continue;
    near.push({ v, index: nearIndex.slice(0, found), distance: nearDistance.slice(0, found) });
    const h = nearIndex[0]!;
    const out =
      (x - headTree.points[h * 3]!) * headNormals[h * 3]! +
      (y - headTree.points[h * 3 + 1]!) * headNormals[h * 3 + 1]! +
      (z - headTree.points[h * 3 + 2]!) * headNormals[h * 3 + 2]!;
    want[h] = Math.max(want[h]!, HEAD_CLEARANCE - out);
  }

  // Every garment vertex near the head: the blended push of its head points.
  const e = garment.bindMatrixInverse.elements;
  let moved = 0;
  for (const { v, index, distance } of near) {
    let push = 0;
    let total = 0;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let n = 0; n < index.length; n += 1) {
      const h = index[n]!;
      const w = 1 / Math.max(distance[n]!, 1e-5);
      push += w * want[h]!;
      nx += w * headNormals[h * 3]!;
      ny += w * headNormals[h * 3 + 1]!;
      nz += w * headNormals[h * 3 + 2]!;
      total += w;
    }
    const t = Math.min(1, Math.max(0, (HEAD_REACH - distance[0]!) / (HEAD_REACH / 2)));
    // At least what its own nearest head point asks for: a blend with points
    // nothing comes near would leave the deepest vertices short of clearing.
    const shift = Math.max(want[index[0]!]!, push / total) * t * t * (3 - 2 * t);
    const length = Math.hypot(nx, ny, nz);
    if (shift <= 0 || length === 0) continue;
    // Bind-frame direction back into the garment's own frame.
    const dx = (nx / length) * shift;
    const dy = (ny / length) * shift;
    const dz = (nz / length) * shift;
    position.setXYZ(
      v,
      position.getX(v) + e[0]! * dx + e[4]! * dy + e[8]! * dz,
      position.getY(v) + e[1]! * dx + e[5]! * dy + e[9]! * dz,
      position.getZ(v) + e[2]! * dx + e[6]! * dy + e[10]! * dz,
    );
    moved += 1;
  }
  if (moved > 0) {
    position.needsUpdate = true;
    geometry.boundingSphere = null;
    geometry.boundingBox = null;
  }
  return moved;
}
/** Outer garment vertices this far (m) from the garment under them can move off it. */
const LAYER_REACH = 0.03;
/** Inner garment points one outer vertex is compared with. */
const LAYER_NEIGHBOURS = 8;
/** Outer vertices each inner point asks directly (see the cover pass in layerGarments). */
const LAYER_COVER = 6;
/** Clearance (m) an outer garment keeps over the one under it. */
const LAYER_CLEARANCE = 0.004;
/** Largest move (m): deeper than this, the two pieces are not meant to overlap there. */
const LAYER_MAX_PUSH = 0.03;
/** Body skin farther than this (m) from a garment vertex gives it no outward direction. */
const BODY_REACH = 0.15;

interface BodyFrame {
  signature: number;
  tree: PointTree;
  /** Outward unit normal of each body point (the tree's point order). */
  normals: Float32Array;
}

const bodyFrames = new WeakMap<SkinnedMesh, BodyFrame>();

/** The body's skin in its bind frame (sliders applied), with outward normals. */
function bodyFrame(body: SkinnedMesh): BodyFrame {
  const signature = bindSignature(body);
  const cached = bodyFrames.get(body);
  if (cached?.signature === signature) return cached;
  const position = body.geometry.getAttribute('position') as Attribute;
  const normal = body.geometry.getAttribute('normal') as Attribute;
  const morphs = activeMorphs(body);
  const points = new Float32Array(position.count * 3);
  const normals = new Float32Array(position.count * 3);
  const point = new Float32Array(3);
  const e = body.bindMatrix.elements;
  for (let v = 0; v < position.count; v += 1) {
    bindPoint(body, morphs, v, point);
    points.set(point, v * 3);
    const nx = normal.getX(v);
    const ny = normal.getY(v);
    const nz = normal.getZ(v);
    const x = e[0]! * nx + e[4]! * ny + e[8]! * nz;
    const y = e[1]! * nx + e[5]! * ny + e[9]! * nz;
    const z = e[2]! * nx + e[6]! * ny + e[10]! * nz;
    const length = Math.hypot(x, y, z) || 1;
    normals[v * 3] = x / length;
    normals[v * 3 + 1] = y / length;
    normals[v * 3 + 2] = z / length;
  }
  const frame = { signature, tree: buildTree(points), normals };
  bodyFrames.set(body, frame);
  return frame;
}

/**
 * Puts a garment back where it was before any layering (its positions as worn,
 * collar fit included), keeping that copy on first use.
 */
function restoreLayerBase(garment: SkinnedMesh): void {
  const position = garment.geometry.getAttribute('position') as Attribute;
  const base = garment.userData.mhLayerBase as typeof position.array | undefined;
  if (!base) {
    garment.userData.mhLayerBase = position.array.slice();
    return;
  }
  position.array.set(base);
  position.needsUpdate = true;
  garment.geometry.boundingSphere = null;
  garment.geometry.boundingBox = null;
}

/**
 * Layering of garments worn together: moves the outer ones off the inner ones
 * where those come through them.
 *
 * Every garment is fitted to the bare body on its own, so where two overlap (a
 * T-shirt over the waistband of jeans) the inner one often lies outside the
 * outer one and shows through it. Each inner point an outer vertex comes near
 * asks for the push, along the body's outward normal, that takes the outer
 * garment over it with LAYER_CLEARANCE to spare; each outer vertex then moves
 * by a blend of what its nearest inner points ask for, faded out towards
 * LAYER_REACH. Both faces of an outer hem take the same push, so they keep
 * their order. Bind frame (sliders applied). Starts from the outer garments'
 * unlayered positions every time, so calling it again after a slider change or
 * with other inner garments does not add up; with no inner garments it only
 * restores them. Returns how many outer vertices moved.
 */
export function layerGarments(
  outer: readonly SkinnedMesh[],
  inner: readonly SkinnedMesh[],
  body: SkinnedMesh,
): number {
  for (const garment of outer) restoreLayerBase(garment);
  if (outer.length === 0 || inner.length === 0) return 0;

  let total = 0;
  for (const garment of inner) total += garment.geometry.getAttribute('position').count;
  const innerPoints = new Float32Array(total * 3);
  const lo: Vec3Array = [Infinity, Infinity, Infinity];
  const hi: Vec3Array = [-Infinity, -Infinity, -Infinity];
  const point = new Float32Array(3);
  let offset = 0;
  for (const garment of inner) {
    const morphs = activeMorphs(garment);
    const count = garment.geometry.getAttribute('position').count;
    for (let v = 0; v < count; v += 1) {
      bindPoint(garment, morphs, v, point);
      innerPoints.set(point, offset * 3);
      for (let a = 0; a < 3; a += 1) {
        lo[a] = Math.min(lo[a], point[a]!);
        hi[a] = Math.max(hi[a], point[a]!);
      }
      offset += 1;
    }
  }
  const innerTree = buildTree(innerPoints);
  const skin = bodyFrame(body);

  const want = new Float32Array(total);
  const nearIndex = new Int32Array(LAYER_NEIGHBOURS);
  const nearDistance = new Float64Array(LAYER_NEIGHBOURS);
  const bodyIndex = new Int32Array(1);
  const bodyDistance = new Float64Array(1);
  const near: {
    garment: SkinnedMesh;
    v: number;
    point: [number, number, number];
    index: Int32Array;
    distance: Float64Array;
    normal: number;
  }[] = [];

  // What each inner point asks for: enough to clear it under every outer vertex near it.
  for (const garment of outer) {
    const morphs = activeMorphs(garment);
    const count = garment.geometry.getAttribute('position').count;
    for (let v = 0; v < count; v += 1) {
      bindPoint(garment, morphs, v, point);
      if (!withinBox(point, lo, hi, LAYER_REACH)) continue;
      const x = point[0]!;
      const y = point[1]!;
      const z = point[2]!;
      const found = nearestPoints(
        innerTree,
        x,
        y,
        z,
        LAYER_NEIGHBOURS,
        LAYER_REACH,
        nearIndex,
        nearDistance,
      );
      if (found === 0) continue;
      if (nearestPoints(skin.tree, x, y, z, 1, BODY_REACH, bodyIndex, bodyDistance) === 0) continue;
      const b = bodyIndex[0]!;
      const nx = skin.normals[b * 3]!;
      const ny = skin.normals[b * 3 + 1]!;
      const nz = skin.normals[b * 3 + 2]!;
      // Distances along the skin, not through it: both faces of a hem (a few
      // mm apart along the normal) then weigh their inner points alike and
      // move alike, so the lining never comes out past the outside.
      const lateral = new Float64Array(found);
      for (let n = 0; n < found; n += 1) {
        const h = nearIndex[n]!;
        const along =
          (innerTree.points[h * 3]! - x) * nx +
          (innerTree.points[h * 3 + 1]! - y) * ny +
          (innerTree.points[h * 3 + 2]! - z) * nz;
        lateral[n] = Math.sqrt(Math.max(0, nearDistance[n]! ** 2 - along * along));
        const depth = along + LAYER_CLEARANCE;
        if (depth <= LAYER_MAX_PUSH) want[h] = Math.max(want[h]!, depth);
      }
      near.push({
        garment,
        v,
        point: [x, y, z],
        index: nearIndex.slice(0, found),
        distance: lateral,
        normal: b,
      });
    }
  }

  // Cover pass: an inner point between sparse outer vertices (the button tab of
  // trousers under a T-shirt) can be no vertex's nearest and would come through
  // the triangle over it. Each inner point also asks the outer vertices around
  // it directly, fading with the distance along the skin.
  const cover = new Float32Array(near.length);
  if (near.length > 0) {
    const outerPoints = new Float32Array(near.length * 3);
    const outerLo: Vec3Array = [Infinity, Infinity, Infinity];
    const outerHi: Vec3Array = [-Infinity, -Infinity, -Infinity];
    near.forEach(({ point: p }, i) => {
      outerPoints.set(p, i * 3);
      for (let a = 0; a < 3; a += 1) {
        outerLo[a] = Math.min(outerLo[a], p[a]);
        outerHi[a] = Math.max(outerHi[a], p[a]);
      }
    });
    const outerTree = buildTree(outerPoints);
    const coverIndex = new Int32Array(LAYER_COVER);
    const coverDistance = new Float64Array(LAYER_COVER);
    const coverAlong = new Float64Array(LAYER_COVER);
    const alongNormal = (q: Float32Array, { point: p, normal }: (typeof near)[number]) =>
      (q[0]! - p[0]) * skin.normals[normal * 3]! +
      (q[1]! - p[1]) * skin.normals[normal * 3 + 1]! +
      (q[2]! - p[2]) * skin.normals[normal * 3 + 2]!;
    for (let h = 0; h < total; h += 1) {
      point.set(innerPoints.subarray(h * 3, h * 3 + 3));
      if (!withinBox(point, outerLo, outerHi, LAYER_REACH)) continue;
      const found = nearestPoints(
        outerTree,
        point[0]!,
        point[1]!,
        point[2]!,
        LAYER_COVER,
        LAYER_REACH,
        coverIndex,
        coverDistance,
      );
      // How far the point stands out of the outermost of those vertices: every
      // layer under it (a hem's lining) takes that same push and keeps its gap.
      let outermost = Infinity;
      for (let n = 0; n < found; n += 1) {
        coverAlong[n] = alongNormal(point, near[coverIndex[n]!]!);
        outermost = Math.min(outermost, coverAlong[n]!);
      }
      const depth = outermost + LAYER_CLEARANCE;
      if (found === 0 || depth <= 0 || depth > LAYER_MAX_PUSH) continue;
      for (let n = 0; n < found; n += 1) {
        const i = coverIndex[n]!;
        const along = coverAlong[n]!;
        const lateral = Math.sqrt(Math.max(0, coverDistance[n]! ** 2 - along * along));
        const t = Math.min(1, Math.max(0, (LAYER_REACH - lateral) / (LAYER_REACH / 2)));
        cover[i] = Math.max(cover[i]!, depth * t * t * (3 - 2 * t));
      }
    }
  }

  // Every outer vertex near an inner garment: the blended push of its inner points.
  const touched = new Set<SkinnedMesh>();
  let moved = 0;
  for (const [i, { garment, v, index, distance, normal }] of near.entries()) {
    let push = 0;
    let weights = 0;
    let strongest = 0;
    let closest = Infinity;
    for (let n = 0; n < index.length; n += 1) {
      const w = 1 / Math.max(distance[n]!, 1e-3);
      push += w * want[index[n]!]!;
      weights += w;
      strongest = Math.max(strongest, want[index[n]!]!);
      closest = Math.min(closest, distance[n]!);
    }
    const t = Math.min(1, Math.max(0, (LAYER_REACH - closest) / (LAYER_REACH / 2)));
    // Close to the inner garment the strongest ask wins (no vertex is left
    // short of clearing it); farther away the blend fades the move out.
    const blend = push / weights;
    const shift = Math.max((blend + (strongest - blend) * t) * t * t * (3 - 2 * t), cover[i]!);
    if (shift <= 0) continue;
    const dx = skin.normals[normal * 3]! * shift;
    const dy = skin.normals[normal * 3 + 1]! * shift;
    const dz = skin.normals[normal * 3 + 2]! * shift;
    const e = garment.bindMatrixInverse.elements;
    const position = garment.geometry.getAttribute('position') as Attribute;
    position.setXYZ(
      v,
      position.getX(v) + e[0]! * dx + e[4]! * dy + e[8]! * dz,
      position.getY(v) + e[1]! * dx + e[5]! * dy + e[9]! * dz,
      position.getZ(v) + e[2]! * dx + e[6]! * dy + e[10]! * dz,
    );
    touched.add(garment);
    moved += 1;
  }
  for (const garment of touched) {
    garment.geometry.getAttribute('position').needsUpdate = true;
    garment.geometry.boundingSphere = null;
    garment.geometry.boundingBox = null;
  }
  return moved;
}
