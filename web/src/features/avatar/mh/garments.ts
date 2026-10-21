import { BufferAttribute, type InterleavedBufferAttribute, type SkinnedMesh } from 'three';

import type { BodyRig } from './assembly';

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

/**
 * Hides the skin under every worn garment: the union of their masks becomes
 * the body's BODY_HIDDEN attribute, which the body skin shader discards on.
 */
export function applyBodyHide(body: SkinnedMesh, masks: readonly Uint8Array[]): void {
  const count = (body.geometry.getAttribute('position') as Attribute).count;
  const hidden = new Float32Array(count);
  for (const mask of masks) {
    if (mask.length !== count) continue;
    for (let v = 0; v < count; v += 1) if (mask[v]) hidden[v] = 1;
  }
  body.geometry.setAttribute(BODY_HIDDEN, new BufferAttribute(hidden, 1));
}
