import type { Object3D } from 'three';

import { IDENTITY_AXES, scaleToLocal, type AxisMap, type Vec3 } from './boneAxes';

/**
 * Body type via bone scaling. Profiles are written in canonical axes (x left,
 * y up, z forward): arms run along x, legs and spine along y, so a per-bone
 * (x, y, z) scale reads as length/width/depth on any model; `axes` maps them
 * onto each bone's own rest orientation (VRM 1.0 bones point along limbs).
 * Bones that must keep their size (head, hands, feet, and shoulders so arms
 * don't stretch) cancel the scale they inherit.
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

export interface BodyShapeOptions {
  /** Rest-pose axes per bone; defaults to axis-aligned (VRoid VRM 0.x). */
  axes?: (bone: Object3D) => AxisMap;
  /** Extra per-bone scale in canonical axes (part fitting); not passed on to children. */
  fit?: (name: string) => Vec3 | undefined;
}

const ONE: Vec3 = [1, 1, 1];
const PROTECTED = new Set<string>(PROTECTED_BONES);

const multiply = (a: Scale3, b: Scale3): Vec3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const divide = (a: Scale3, b: Scale3): Vec3 => [a[0] / b[0], a[1] / b[1], a[2] / b[2]];

/** Nearest ancestor that is one of the humanoid bones being shaped. */
function humanoidParent(bone: Object3D, names: Map<Object3D, string>): string | undefined {
  for (let node = bone.parent; node; node = node.parent) {
    const name = names.get(node);
    if (name) return name;
  }
  return undefined;
}

/**
 * Apply a body shape to a skeleton. Idempotent: every scale is derived from
 * scratch, so the same call can be repeated on base and part VRMs whenever
 * the shape changes. `allBones` must list parents before children.
 *
 * Scales are reasoned about as canonical world scales relative to the root
 * (the root's own uniform scale is the height): a bone's build scale is its
 * parent's times its profile, protected bones reset to one, and a fit only
 * applies to its own bone. Local scale = own world / parent world.
 */
export function applyBodyShape(
  bones: BoneLookup,
  allBones: readonly string[],
  shape: BodyShape,
  { axes = () => IDENTITY_AXES, fit }: BodyShapeOptions = {},
): void {
  const names = new Map<Object3D, string>();
  for (const name of allBones) {
    const bone = bones(name);
    if (bone) names.set(bone, name);
  }

  const build = new Map<string, Vec3>();
  const final = new Map<string, Vec3>();
  const profile = PROFILES[shape.build];
  for (const name of allBones) {
    const bone = bones(name);
    if (!bone) continue;
    const parent = humanoidParent(bone, names);
    const inherited = (parent && build.get(parent)) || ONE;
    const own = PROTECTED.has(name) ? ONE : multiply(inherited, profile[name] ?? ONE);
    build.set(name, own);
    const fitted = multiply(own, fit?.(name) ?? ONE);
    final.set(name, fitted);
    const parentFinal = (parent && final.get(parent)) || ONE;
    bone.scale.set(...scaleToLocal(divide(fitted, parentFinal), axes(bone)));
  }
}

export function clampHeight(height: number): number {
  return Math.min(HEIGHT_RANGE.max, Math.max(HEIGHT_RANGE.min, height));
}
