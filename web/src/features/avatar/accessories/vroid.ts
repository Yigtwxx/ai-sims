import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { Vector3, type Object3D } from 'three';

import { classifyMaterial } from '../vrm/partCategories';
import {
  firstMaterial,
  headFrameFromEyes,
  uprightFrame,
  type Frame,
  type RoleClassifier,
  type SurfaceMesh,
} from './surface';

/**
 * Rig adapter for VRoid-exported VRM characters. Everything that depends on
 * VRoid material naming or on the VRM humanoid lives here; the rest of the
 * accessory module only sees surfaces, bones and frames, so another rig
 * (e.g. a realistic one) replaces just this file.
 */

/** VRoid names materials consistently ("N00_000_00_Face_00_SKIN"), so roles come from names. */
export const vroidSurfaceRole: RoleClassifier = (_mesh, materialName) =>
  classifyMaterial(materialName);

/** VRoid skin materials (head and body) end in "_SKIN"; eyes, brows and lashes do not. */
export function isVroidSkin(surface: SurfaceMesh): boolean {
  return /_SKIN\b/i.test(firstMaterial(surface.mesh).name ?? '');
}

/** The raw (skinning) bone for a humanoid bone name. */
export function vrmBone(vrm: VRM, name: VRMHumanBoneName): Object3D | undefined {
  return vrm.humanoid?.getRawBoneNode(name) ?? undefined;
}

function bonePosition(vrm: VRM, name: VRMHumanBoneName): Vector3 | undefined {
  return vrmBone(vrm, name)?.getWorldPosition(new Vector3());
}

/**
 * Head frame of a VRM: left from the eye bones (VRM 0.x and 1.0 agree on
 * which eye is left), up from the normalized head bone, whose rest frame is
 * upright in both versions. Origin between the eye bones. Note that VRoid eye
 * bones sit well inside the visible eyes; fit glasses to the eye meshes.
 */
export function vrmHeadFrame(vrm: VRM): Frame | undefined {
  const normalizedHead = vrm.humanoid?.getNormalizedBoneNode('head');
  const left = bonePosition(vrm, 'leftEye');
  const right = bonePosition(vrm, 'rightEye');
  if (!normalizedHead || !left || !right) return undefined;
  normalizedHead.updateWorldMatrix(true, false);
  const up = new Vector3().setFromMatrixColumn(normalizedHead.matrixWorld, 1);
  return headFrameFromEyes(left, right, up);
}

/** Upright frame at a humanoid bone; left from the upper arms. */
export function vrmBodyFrame(vrm: VRM, at: VRMHumanBoneName): Frame | undefined {
  const origin = bonePosition(vrm, at);
  const left = bonePosition(vrm, 'leftUpperArm') ?? bonePosition(vrm, 'leftShoulder');
  const right = bonePosition(vrm, 'rightUpperArm') ?? bonePosition(vrm, 'rightShoulder');
  return origin && left && right ? uprightFrame(origin, left, right) : undefined;
}

/**
 * Donors copy the base pose inside the avatar's frame loop; until their first
 * sync their joints sit elsewhere, so measuring them would be wrong.
 */
export function donorsSynced(base: VRM, donors: readonly VRM[], tolerance = 1e-4): boolean {
  const head = bonePosition(base, 'head');
  if (!head) return true;
  return donors.every((donor) => {
    const donorHead = bonePosition(donor, 'head');
    return !donorHead || donorHead.distanceTo(head) <= tolerance;
  });
}
