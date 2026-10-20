import { Bone, Object3D, Quaternion, Vector3, type SkinnedMesh } from 'three';

/**
 * Helpers for working with the MPFB "mixamo_unity" skeleton after GLTFLoader
 * sanitises names (e.g. "mixamorig:LeftArm" -> "mixamorigLeftArm").
 */

export type BoneMap = Map<string, Bone>;

/** Index bones by their name with any "mixamorig" prefix removed. */
export function collectBones(root: Object3D): BoneMap {
  const bones: BoneMap = new Map();
  root.traverse((obj) => {
    if ((obj as Bone).isBone) bones.set(obj.name.replace(/^mixamorig[:_]?/, ''), obj as Bone);
  });
  return bones;
}

export function collectMorphMeshes(root: Object3D): SkinnedMesh[] {
  const meshes: SkinnedMesh[] = [];
  root.traverse((obj) => {
    const mesh = obj as SkinnedMesh;
    if (mesh.isMesh && mesh.morphTargetDictionary) meshes.push(mesh);
  });
  return meshes;
}

const _parentWorld = new Quaternion();
const _boneWorld = new Quaternion();
const _delta = new Quaternion();

const _from = new Vector3();
const _to = new Vector3();
const _bonePos = new Vector3();
const _childPos = new Vector3();

/**
 * Rotate `bone` so the segment towards `child` points along `direction`
 * (world space). Idempotent: running it twice yields the same pose, which
 * matters under React StrictMode's double effects.
 */
export function aimBone(bone: Bone, child: Bone, direction: Vector3): void {
  bone.updateWorldMatrix(true, true);
  bone.getWorldPosition(_bonePos);
  child.getWorldPosition(_childPos);
  _from.subVectors(_childPos, _bonePos).normalize();
  _to.copy(direction).normalize();
  if (_from.dot(_to) > 0.99999) return;

  _delta.setFromUnitVectors(_from, _to);
  bone.getWorldQuaternion(_boneWorld);
  if (bone.parent) bone.parent.getWorldQuaternion(_parentWorld);
  else _parentWorld.identity();
  _boneWorld.premultiply(_delta);
  bone.quaternion.copy(_parentWorld.invert().multiply(_boneWorld));
  bone.updateWorldMatrix(false, true);
}

/** Bone chain segments and their target directions (character faces +Z, left is +X). */
const RELAXED_POSE: ReadonlyArray<[bone: string, child: string, direction: Vector3]> = [
  ['LeftArm', 'LeftForeArm', new Vector3(0.2, -1, -0.02)],
  ['LeftForeArm', 'LeftHand', new Vector3(0.1, -1, 0.14)],
  ['RightArm', 'RightForeArm', new Vector3(-0.2, -1, -0.02)],
  ['RightForeArm', 'RightHand', new Vector3(-0.1, -1, 0.14)],
];

/** Relaxed standing pose: arms down along the body with a slight elbow bend. */
export function applyRelaxedPose(bones: BoneMap): void {
  for (const [boneName, childName, direction] of RELAXED_POSE) {
    const bone = bones.get(boneName);
    const child = bones.get(childName);
    if (bone && child) aimBone(bone, child, direction);
  }
}
