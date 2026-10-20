import { VRMHumanBoneList, type VRM } from '@pixiv/three-vrm';
import { Vector3, type Material, type Mesh, type Object3D, type SkinnedMesh } from 'three';

import {
  PART_CATEGORIES,
  classifyMaterial,
  isOnepiece,
  isPartCategory,
  type PartCategory,
} from './partCategories';
import { isVrm0 } from './vrmRuntime';

/**
 * Part assembly. Each part comes from a donor VRM that is rendered next to
 * the base with only that part's primitives visible. Every frame the donor
 * copies the base's pose (normalized rotations) and joint positions, so the
 * garment deforms onto the base body's proportions while the donor keeps its
 * own spring bones (hair, skirts) running.
 */

/** Part selection: a donor VRM URL, `null` for none, or omitted for the base's own. */
export type PartSelection = Partial<Record<PartCategory, string | null>>;

function materialName(mesh: Mesh): string {
  const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
    Material | undefined;
  return material?.name ?? '';
}

function forEachMesh(vrm: VRM, fn: (mesh: Mesh) => void): void {
  vrm.scene.traverse((obj) => {
    const mesh = obj as Mesh;
    if (mesh.isMesh) fn(mesh);
  });
}

/** True when the donor's top is a one-piece, which also replaces the bottom. */
export function hasOnepiece(vrm: VRM): boolean {
  let found = false;
  forEachMesh(vrm, (mesh) => {
    if (isOnepiece(materialName(mesh))) found = true;
  });
  return found;
}

/** Which categories each VRM should show, given the base and a selection. */
export function resolveVisibility(
  baseUrl: string,
  selection: PartSelection,
  onepieceTop: boolean,
): { base: Set<PartCategory>; donors: Map<string, Set<PartCategory>> } {
  const base = new Set<PartCategory>();
  const donors = new Map<string, Set<PartCategory>>();
  for (const category of PART_CATEGORIES) {
    const choice = selection[category];
    if (category === 'bottom' && onepieceTop) continue;
    if (choice === undefined || choice === baseUrl) base.add(category);
    else if (choice !== null) {
      const set = donors.get(choice) ?? new Set<PartCategory>();
      set.add(category);
      donors.set(choice, set);
    }
  }
  return { base, donors };
}

/** Show base roles (face, body, accessories) plus the listed part categories. */
export function applyBaseVisibility(vrm: VRM, parts: Set<PartCategory>): void {
  forEachMesh(vrm, (mesh) => {
    const role = classifyMaterial(materialName(mesh));
    mesh.visible = isPartCategory(role) ? parts.has(role) : true;
  });
}

/** Show only the listed part categories of a donor. */
export function applyDonorVisibility(vrm: VRM, parts: Set<PartCategory>): void {
  forEachMesh(vrm, (mesh) => {
    const role = classifyMaterial(materialName(mesh));
    mesh.visible = isPartCategory(role) && parts.has(role);
  });
}

/** Bones that actually move at least one vertex of a visible skinned mesh. */
function influentialBones(vrm: VRM): Set<Object3D> {
  const bones = new Set<Object3D>();
  vrm.scene.traverse((obj) => {
    const mesh = obj as SkinnedMesh;
    if (!mesh.isSkinnedMesh || !mesh.visible) return;
    const indices = mesh.geometry.getAttribute('skinIndex');
    const weights = mesh.geometry.getAttribute('skinWeight');
    if (!indices || !weights) return;
    for (let v = 0; v < indices.count; v++) {
      for (let k = 0; k < 4; k++) {
        if (weights.getComponent(v, k) > 0)
          bones.add(mesh.skeleton.bones[indices.getComponent(v, k)]);
      }
    }
  });
  return bones;
}

/**
 * Remove spring joints whose chain moves nothing visible (a hair part still
 * carries the skirt springs of its source model). Saves simulation time for
 * every donor on screen.
 */
export function pruneSpringBones(vrm: VRM): number {
  const manager = vrm.springBoneManager;
  if (!manager) return 0;
  const used = influentialBones(vrm);
  const movesSomething = (bone: Object3D) => {
    let found = false;
    bone.traverse((child) => {
      if (used.has(child)) found = true;
    });
    return found;
  };
  let removed = 0;
  for (const joint of [...manager.joints]) {
    if (!movesSomething(joint.bone)) {
      manager.deleteJoint(joint);
      removed++;
    }
  }
  return removed;
}

const _position = new Vector3();

/**
 * Drive a donor from the base: copy normalized rotations (version-agnostic,
 * works across VRM 0.x/1.0), then move each raw joint onto the base joint's
 * world position so limb lengths match, then step the donor's spring bones.
 * The base's world matrices must be current (call after the base update).
 */
export function syncDonor(base: VRM, donor: VRM, dt: number): void {
  const baseHumanoid = base.humanoid;
  const donorHumanoid = donor.humanoid;
  if (!baseHumanoid || !donorHumanoid) return;

  // VRM 0.x and 1.0 normalized spaces mirror the X and Z rotation axes.
  const mirror = isVrm0(base) !== isVrm0(donor);
  for (const name of VRMHumanBoneList) {
    const from = baseHumanoid.getNormalizedBoneNode(name);
    const to = donorHumanoid.getNormalizedBoneNode(name);
    if (!from || !to) continue;
    to.quaternion.copy(from.quaternion);
    if (mirror) {
      to.quaternion.x *= -1;
      to.quaternion.z *= -1;
    }
  }
  donorHumanoid.update();
  donor.scene.updateMatrixWorld(true);

  // Parents come before children in VRMHumanBoneList, so one pass suffices.
  for (const name of VRMHumanBoneList) {
    const from = baseHumanoid.getRawBoneNode(name);
    const to = donorHumanoid.getRawBoneNode(name);
    if (!from || !to?.parent) continue;
    from.getWorldPosition(_position);
    to.parent.updateWorldMatrix(false, false);
    to.position.copy(to.parent.worldToLocal(_position));
    to.updateWorldMatrix(false, false);
  }
  donor.scene.updateMatrixWorld(true);
  donor.springBoneManager?.update(dt);
  // MToon pushes material properties (alpha cutoff, colours, UV animation)
  // into uniforms in update(); without it cutout garments render as solid
  // templates. vrm.update() would do this, but it would also overwrite the pose.
  for (const material of donor.materials ?? []) {
    (material as { update?: (delta: number) => void }).update?.(dt);
  }
}
