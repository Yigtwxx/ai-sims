import { Quaternion, Vector3, type Bone, type Object3D } from 'three';

import type { BoneRotation } from './idle';

/**
 * Applies character-space bone rotations (see ./idle.ts) on top of the rest
 * pose. Each frame starts from rest, so layers never accumulate, and the rest
 * pose stays exact for rebinding when body sliders change.
 */
export interface PoseRig {
  bones: Map<string, Bone>;
  rest: Map<string, Quaternion>;
  /** Parent orientation relative to the character root, at rest. */
  parentRest: Map<string, Quaternion>;
}

/**
 * Captures rest orientations of `names` under `root`. Call once after assembly,
 * with the bones at rest; body sliders only translate joints, so it stays valid.
 */
export function createPoseRig(root: Object3D, names: Iterable<string>): PoseRig {
  root.updateMatrixWorld(true);
  const rootInverse = root.getWorldQuaternion(new Quaternion()).invert();
  const rig: PoseRig = { bones: new Map(), rest: new Map(), parentRest: new Map() };
  for (const name of names) {
    const bone = root.getObjectByName(name) as Bone | undefined;
    if (!bone?.isBone || !bone.parent) continue;
    rig.bones.set(name, bone);
    rig.rest.set(name, bone.quaternion.clone());
    rig.parentRest.set(
      name,
      rootInverse.clone().multiply(bone.parent.getWorldQuaternion(new Quaternion())),
    );
  }
  return rig;
}

const axis = new Vector3();
const delta = new Quaternion();
const local = new Quaternion();

/** Puts every rig bone back to its rest rotation. */
export function resetPose(rig: PoseRig): void {
  for (const [name, bone] of rig.bones) bone.quaternion.copy(rig.rest.get(name)!);
}

/** Resets every rig bone to rest, then applies the rotations in order. */
export function applyPose(rig: PoseRig, rotations: readonly BoneRotation[]): void {
  resetPose(rig);
  addRotations(rig, rotations);
}

/**
 * Applies character-space rotations on top of the bones' current rotation
 * (e.g. what a mocap clip wrote this frame). Call resetPose first each frame
 * for bones no clip animates, or the rotations accumulate.
 */
export function addRotations(rig: PoseRig, rotations: readonly BoneRotation[]): void {
  for (const { bone: name, axis: a, angle } of rotations) {
    const bone = rig.bones.get(name);
    if (!bone || angle === 0) continue;
    const parent = rig.parentRest.get(name)!;
    // Character-space rotation expressed in the parent's frame: P⁻¹ · D · P.
    delta.setFromAxisAngle(axis.set(a[0], a[1], a[2]), angle);
    local.copy(parent).invert().multiply(delta).multiply(parent);
    bone.quaternion.premultiply(local);
  }
}
