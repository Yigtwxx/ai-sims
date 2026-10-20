import type { VRM } from '@pixiv/three-vrm';
import { Matrix4, type Object3D, type SkinnedMesh } from 'three';

/**
 * Bone axes versus the character's canonical axes. VRoid VRM 0.x armatures
 * are axis-aligned at rest, but VRM 1.0 exports orient each bone along its
 * limb, so "make the upper arm thicker" has to be mapped onto whichever local
 * axes point across the arm on that particular model.
 *
 * Canonical axes: x = the character's left, y = up, z = forward (facing the
 * camera after VRMUtils.rotateVRM0).
 */
export type Vec3 = [number, number, number];

export interface AxisMap {
  /** For each local axis, the canonical axis it is closest to. */
  readonly axis: readonly [number, number, number];
  /** +1 when that local axis points along its canonical axis, -1 when opposite. */
  readonly sign: readonly [number, number, number];
}

export const IDENTITY_AXES: AxisMap = { axis: [0, 1, 2], sign: [1, 1, 1] };

/**
 * Axis map from a bone's rest rotation (columns = local axes in model space).
 * VRM 0.x models face -Z in their own space, so x and z flip to reach canonical.
 */
export function axisMapFromRest(restWorld: Matrix4, facesNegativeZ: boolean): AxisMap {
  const e = restWorld.elements;
  const flip = facesNegativeZ ? [-1, 1, -1] : [1, 1, 1];
  // Score every local→canonical pairing, then assign greedily so the result is
  // always a permutation even for bones rolled close to 45 degrees.
  const scores: { local: number; canonical: number; value: number }[] = [];
  for (let local = 0; local < 3; local++) {
    const column = [e[local * 4], e[local * 4 + 1], e[local * 4 + 2]];
    const length = Math.hypot(column[0], column[1], column[2]) || 1;
    for (let canonical = 0; canonical < 3; canonical++) {
      scores.push({ local, canonical, value: (column[canonical] * flip[canonical]) / length });
    }
  }
  scores.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const axis: [number, number, number] = [-1, -1, -1];
  const sign: [number, number, number] = [1, 1, 1];
  const taken = new Set<number>();
  for (const { local, canonical, value } of scores) {
    if (axis[local] !== -1 || taken.has(canonical)) continue;
    axis[local] = canonical;
    sign[local] = value < 0 ? -1 : 1;
    taken.add(canonical);
  }
  return { axis, sign };
}

/** Express a canonical per-axis scale in a bone's local axes. */
export function scaleToLocal(scale: Vec3, map: AxisMap): Vec3 {
  return [scale[map.axis[0]], scale[map.axis[1]], scale[map.axis[2]]];
}

/** Express a canonical vector (e.g. an offset) in a bone's local axes. */
export function vectorToLocal(vector: Vec3, map: AxisMap): Vec3 {
  return [
    vector[map.axis[0]] * map.sign[0],
    vector[map.axis[1]] * map.sign[1],
    vector[map.axis[2]] * map.sign[2],
  ];
}

const _rest = new Matrix4();

/**
 * Rest (bind) rotation of every skinned joint of a VRM, as an axis map. Bind
 * matrices never change, so this stays valid after the model has been posed.
 */
export function boneAxesOf(vrm: VRM): (bone: Object3D) => AxisMap {
  const facesNegativeZ = vrm.meta?.metaVersion === '0';
  const maps = new Map<Object3D, AxisMap>();
  vrm.scene.traverse((obj) => {
    const mesh = obj as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    mesh.skeleton.bones.forEach((bone, i) => {
      if (maps.has(bone)) return;
      // inverse(boneInverse) is the joint's world matrix at bind time.
      _rest.copy(mesh.skeleton.boneInverses[i]).invert();
      maps.set(bone, axisMapFromRest(_rest, facesNegativeZ));
    });
  });
  return (bone) => maps.get(bone) ?? IDENTITY_AXES;
}
