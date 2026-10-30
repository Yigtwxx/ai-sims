import { Matrix4, Vector3, type Bone, type SkinnedMesh } from 'three';

import type { BodyRig } from './assembly';

/**
 * The character in its rest pose: the skeleton as the body sliders left it,
 * with no clip on it. Things fitted to the skin (tattoos, jewellery) are
 * measured here, so where they land never depends on the frame the
 * animation happened to be in.
 */

/**
 * Runs `measure` with the skeleton at rest and puts the pose back. Every
 * bone of the body rig is reset; the face's own bones (eyes) keep their pose,
 * no skin hangs on them.
 */
export function atRest<T>(body: BodyRig, measure: () => T): T {
  const saved: [Bone, Vector3, number, number, number, number, Vector3][] = [];
  for (const [name, bone] of body.bones) {
    const { x, y, z, w } = bone.quaternion;
    saved.push([bone, bone.position.clone(), x, y, z, w, bone.scale.clone()]);
    bone.position.copy(body.sliderPosition.get(name) ?? bone.position);
    bone.quaternion.copy(body.restQuaternion.get(name) ?? bone.quaternion);
    bone.scale.set(1, 1, 1);
  }
  body.root.updateMatrixWorld(true);
  try {
    return measure();
  } finally {
    for (const [bone, position, x, y, z, w, scale] of saved) {
      bone.position.copy(position);
      bone.quaternion.set(x, y, z, w);
      bone.scale.copy(scale);
    }
    body.root.updateMatrixWorld(true);
  }
}

/** World positions at rest of a skinned mesh's vertices near a point. */
export interface RestSample {
  mesh: SkinnedMesh;
  /** xyz per vertex; only vertices marked in `sampled` are filled. */
  positions: Float32Array;
  sampled: Uint8Array;
}

const _v = new Vector3();

/**
 * Samples a mesh's rest positions (call inside atRest) within `radius` of
 * `near` (world). Vertices are pre-selected by their bind position, which the
 * sliders move at most a few centimetres from where they rest, so the region
 * is searched with that much margin. `faceMorphs: false` measures the skin
 * with the face at rest (no expression or viseme); body slider morphs always
 * apply, they are the body's shape.
 */
export function sampleRest(
  mesh: SkinnedMesh,
  near: Vector3,
  radius: number,
  faceMorphs: boolean,
): RestSample {
  const position = mesh.geometry.getAttribute('position');
  const count = position.count;
  const positions = new Float32Array(count * 3);
  const sampled = new Uint8Array(count);
  const influences = mesh.morphTargetInfluences;
  const kept = !faceMorphs && influences ? influences.slice() : null;
  if (kept && influences) influences.fill(0);
  const reach = (radius + SLIDER_MARGIN) ** 2;
  const within = radius * radius;
  try {
    for (let i = 0; i < count; i += 1) {
      _v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      if (_v.distanceToSquared(near) > reach) continue;
      mesh.getVertexPosition(i, _v).applyMatrix4(mesh.matrixWorld);
      if (_v.distanceToSquared(near) > within) continue;
      _v.toArray(positions, i * 3);
      sampled[i] = 1;
    }
  } finally {
    if (kept && influences) for (let k = 0; k < kept.length; k += 1) influences[k] = kept[k]!;
  }
  return { mesh, positions, sampled };
}

/** How far (m) the body sliders move a vertex from its bind position at most (height ±14 cm). */
const SLIDER_MARGIN = 0.2;

/**
 * World position at rest of a bone (call inside atRest): a body bone, else one
 * of the face rig's own (ears, nose, lips) on the head mesh.
 */
export function restJoint(body: BodyRig, name: string, head?: SkinnedMesh): Vector3 | null {
  const bone = body.bones.get(name);
  if (bone) return bone.getWorldPosition(new Vector3());
  return head ? faceJoint(head, name) : null;
}

const _m = new Matrix4();

/**
 * Where the face rig had a joint when the head mesh was bound, carried along
 * rigidly by the head bone. The face rig's own bones are not used: they keep
 * the local transforms of the head file under the body's head bone, whose
 * rest rotation differs, and sit centimetres off (no skin hangs on them).
 */
export function faceJoint(head: SkinnedMesh, name: string): Vector3 | null {
  const { bones, boneInverses } = head.skeleton;
  const joint = bones.findIndex((bone) => bone.name === name);
  const anchor = bones.findIndex((bone) => bone.name === 'head');
  if (joint < 0 || anchor < 0) return null;
  _m.copy(boneInverses[joint]!).invert().premultiply(boneInverses[anchor]!);
  _m.premultiply(bones[anchor]!.matrixWorld);
  return new Vector3().setFromMatrixPosition(_m);
}
