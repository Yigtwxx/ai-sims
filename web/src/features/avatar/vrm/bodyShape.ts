import { Vector3, type Object3D } from 'three';

/**
 * Body type via bone scaling. VRoid raw bones are axis-aligned in the rest
 * pose (arms along X, legs along -Y), so a per-bone (x, y, z) scale reads as
 * width/length/depth. Bones that must keep their size (head, hands, feet,
 * and shoulders so arms don't stretch) cancel the scale they inherit.
 */

export const BODY_BUILDS = ['slim', 'average', 'athletic', 'curvy'] as const;

export type BodyBuild = (typeof BODY_BUILDS)[number];

export interface BodyShape {
  build: BodyBuild;
  /** Overall height multiplier (1 = model as authored). */
  height: number;
}

type Scale3 = readonly [number, number, number];

const PROFILES: Record<BodyBuild, Partial<Record<string, Scale3>>> = {
  slim: {
    hips: [0.94, 1, 0.95],
    spine: [0.93, 1, 0.93],
    chest: [0.93, 1, 0.94],
    leftUpperArm: [1, 0.9, 0.9],
    rightUpperArm: [1, 0.9, 0.9],
    leftUpperLeg: [0.92, 1, 0.92],
    rightUpperLeg: [0.92, 1, 0.92],
  },
  average: {},
  athletic: {
    spine: [1.03, 1, 1.03],
    chest: [1.07, 1, 1.05],
    upperChest: [1.04, 1, 1.03],
    leftUpperArm: [1, 1.1, 1.1],
    rightUpperArm: [1, 1.1, 1.1],
    leftLowerArm: [1, 1.05, 1.05],
    rightLowerArm: [1, 1.05, 1.05],
    leftUpperLeg: [1.05, 1, 1.05],
    rightUpperLeg: [1.05, 1, 1.05],
  },
  curvy: {
    hips: [1.1, 1, 1.06],
    chest: [1.02, 1, 1.06],
    leftUpperLeg: [1.08, 1, 1.08],
    rightUpperLeg: [1.08, 1, 1.08],
  },
};

/** These bones keep their authored size regardless of the build. */
const PROTECTED_BONES = [
  'neck',
  'head',
  'leftShoulder',
  'rightShoulder',
  'leftHand',
  'rightHand',
  'leftFoot',
  'rightFoot',
] as const;

export const DEFAULT_BODY_SHAPE: BodyShape = { build: 'average', height: 1 };

export const HEIGHT_RANGE = { min: 0.92, max: 1.08 } as const;

export type BoneLookup = (name: string) => Object3D | undefined;

const _parentScale = new Vector3();

/**
 * Apply a body shape to a skeleton. Idempotent: scales are reset first, so the
 * same call can be repeated on base and part VRMs whenever the shape changes.
 */
export function applyBodyShape(bones: BoneLookup, allBones: string[], shape: BodyShape): void {
  for (const name of allBones) bones(name)?.scale.set(1, 1, 1);

  for (const [name, scale] of Object.entries(PROFILES[shape.build])) {
    if (scale) bones(name)?.scale.set(...scale);
  }

  for (const name of PROTECTED_BONES) {
    const bone = bones(name);
    if (!bone?.parent) continue;
    bone.parent.updateWorldMatrix(true, false);
    bone.parent.getWorldScale(_parentScale);
    // Divide out everything inherited above the root's own (uniform) scale.
    const rootScale = rootUniformScale(bone);
    bone.scale.set(
      rootScale / _parentScale.x,
      rootScale / _parentScale.y,
      rootScale / _parentScale.z,
    );
    bone.updateWorldMatrix(false, false);
  }
}

function rootUniformScale(bone: Object3D): number {
  let root: Object3D = bone;
  while (root.parent) root = root.parent;
  return root.scale.x;
}

export function clampHeight(height: number): number {
  return Math.min(HEIGHT_RANGE.max, Math.max(HEIGHT_RANGE.min, height));
}
