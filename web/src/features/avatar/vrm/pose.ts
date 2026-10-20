import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';

/**
 * Natural standing pose and idle motion, authored in VRM 1.0 normalized space
 * (character faces +Z, left side is +X, T-pose rest). VRM 0.x mirrors the X
 * and Z rotation axes, so those components flip sign for 0.x models.
 *
 * The pose is a relaxed contrapposto: weight on the right leg, left knee
 * eased, hips and shoulders counter-tilted, arms hanging close with soft
 * elbows, fingers curled progressively, head slightly tilted.
 */

type Euler3 = readonly [x: number, y: number, z: number];

export type Pose = Partial<Record<VRMHumanBoneName, Euler3>>;

const FINGER_CURL: Euler3[] = [
  [0, 0, -0.22], // proximal
  [0, 0, -0.42], // intermediate
  [0, 0, -0.3], // distal
];

/** Builds left and right finger curls; right side mirrors the Z rotation. */
function fingers(side: 'left' | 'right', spread: number): Pose {
  const sign = side === 'left' ? 1 : -1;
  const pose: Pose = {};
  const names = ['Index', 'Middle', 'Ring', 'Little'] as const;
  const joints = ['Proximal', 'Intermediate', 'Distal'] as const;
  names.forEach((finger, f) => {
    // Outer fingers curl a little more and fan slightly, like a resting hand.
    const extra = 1 + f * 0.12;
    joints.forEach((joint, j) => {
      const [x, y, z] = FINGER_CURL[j];
      const fan = j === 0 ? (f - 1.5) * spread : 0;
      pose[`${side}${finger}${joint}` as VRMHumanBoneName] = [x, y + fan * sign, z * extra * sign];
    });
  });
  pose[`${side}ThumbProximal` as VRMHumanBoneName] = [0.15 * sign, 0.25 * sign, -0.1 * sign];
  pose[`${side}ThumbDistal` as VRMHumanBoneName] = [0, 0.2 * sign, -0.15 * sign];
  return pose;
}

export const RELAXED_POSE: Pose = {
  hips: [0, 0.03, 0.035],
  spine: [0.02, -0.02, -0.02],
  chest: [0.015, -0.02, -0.02],
  upperChest: [0, 0, -0.01],
  neck: [-0.02, 0.02, 0.02],
  head: [0.03, 0.03, 0.035],
  leftShoulder: [0, 0, -0.06],
  rightShoulder: [0, 0, 0.06],
  leftUpperArm: [0.06, 0.12, -1.4],
  rightUpperArm: [0.06, -0.12, 1.36],
  leftLowerArm: [0, -0.36, 0],
  rightLowerArm: [0, 0.3, 0],
  leftHand: [0.08, -0.05, -0.12],
  rightHand: [0.08, 0.05, 0.12],
  // Weight on the right leg; the left knee eases forward.
  leftUpperLeg: [-0.06, 0.02, 0.02],
  leftLowerLeg: [0.14, 0, 0],
  leftFoot: [-0.07, 0.06, 0],
  rightUpperLeg: [0.01, -0.02, 0.01],
  ...fingers('left', 0.05),
  ...fingers('right', 0.05),
};

export function mirrorForVersion(euler: Euler3, vrm0: boolean): Euler3 {
  return vrm0 ? [-euler[0], euler[1], -euler[2]] : euler;
}

/** Idle offsets added on top of the pose at time `t` (seconds). */
export function idleOffsets(t: number): Pose {
  const breath = Math.sin(t * 1.45); // ~14 breaths per minute
  const sway = Math.sin(t * 0.42); // slow weight shift
  const drift = Math.sin(t * 0.27 + 0.8);
  return {
    hips: [0, sway * 0.012, sway * 0.01],
    spine: [breath * 0.006, 0, -sway * 0.006],
    chest: [breath * 0.014, 0, -sway * 0.004],
    neck: [Math.sin(t * 0.53 + 1.3) * 0.015, Math.sin(t * 0.37) * 0.035, 0],
    head: [0, drift * 0.02, drift * 0.01],
    leftUpperArm: [0, 0, -breath * 0.01],
    rightUpperArm: [0, 0, breath * 0.01],
    leftShoulder: [0, 0, -breath * 0.008],
    rightShoulder: [0, 0, breath * 0.008],
  };
}

/** Write pose + idle into the VRM's normalized bones. */
export function applyPose(vrm: VRM, vrm0: boolean, idle?: Pose): void {
  const humanoid = vrm.humanoid;
  if (!humanoid) return;
  const names = new Set<VRMHumanBoneName>([
    ...(Object.keys(RELAXED_POSE) as VRMHumanBoneName[]),
    ...((idle ? Object.keys(idle) : []) as VRMHumanBoneName[]),
  ]);
  for (const name of names) {
    const node = humanoid.getNormalizedBoneNode(name);
    if (!node) continue;
    const base = RELAXED_POSE[name] ?? [0, 0, 0];
    const extra = idle?.[name] ?? [0, 0, 0];
    const [x, y, z] = mirrorForVersion(
      [base[0] + extra[0], base[1] + extra[1], base[2] + extra[2]],
      vrm0,
    );
    node.rotation.set(x, y, z);
  }
}
