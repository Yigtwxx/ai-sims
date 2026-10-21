/**
 * Procedural life layer for a MetaHuman body: relaxed arms instead of the bind
 * A-pose, breathing, a slow weight shift, head micro-motion and eye saccades.
 * Amplitudes stay small on purpose: this layer sits on top of mocap idles once
 * they are converted, and must never read as robotic. Pure functions of time
 * and an injected random source, so the schedule is testable.
 *
 * Rotations are in character space (+Y up, character faces +Z, its left is +X).
 */

import type { MocapLayer } from './motion';

export type Axis = readonly [number, number, number];

export interface BoneRotation {
  bone: string;
  /** A character-space axis, or `twist`: about the bone's own length (local +X on MetaHuman bones). */
  axis: Axis | 'twist';
  /** Radians, right-handed about `axis`. */
  angle: number;
}

export type LifeMode = 'idle' | 'listening' | 'speaking' | 'thinking';

const X: Axis = [1, 0, 0];
const Y: Axis = [0, 1, 0];
const Z: Axis = [0, 0, 1];
const DEG = Math.PI / 180;

/** Bind pose upper arms hang ~37° from vertical; relaxed arms hang ~6-8°. */
export const ARM_RELAX = 30 * DEG;

/**
 * Lowered from the bind pose, the palms face forward and show their light
 * skin; relaxed hands face the thighs. The forearm pronates like a real one:
 * none at the elbow, the twist bones by where they sit along it (1/3, 2/3),
 * the hand fully.
 */
export const PRONATION = 45 * DEG;
const FOREARM_TWIST: readonly (readonly [string, number])[] = [
  ['lowerarm_twist_02', 1 / 3],
  ['lowerarm_twist_01', 2 / 3],
  ['hand', 1],
];

/** Smooth pseudo-noise: a sum of incommensurate sines in -1..1. */
export function drift(t: number, seed: number): number {
  return (
    0.5 * Math.sin(t * 0.31 + seed * 1.7) +
    0.3 * Math.sin(t * 0.73 + seed * 4.1) +
    0.2 * Math.sin(t * 1.37 + seed * 2.3)
  );
}

/** Breathing phase 0..1 → chest lift 0..1, quick inhale and slower exhale. */
export function breath(t: number, period = 4.2): number {
  const phase = (t / period) % 1;
  return phase < 0.4
    ? Math.sin((phase / 0.4) * (Math.PI / 2))
    : Math.cos(((phase - 0.4) / 0.6) * (Math.PI / 2));
}

export interface IdleInput {
  t: number;
  mode: LifeMode;
  /** Speech loudness 0..1 while speaking (drives head emphasis). */
  loudness?: number;
  /**
   * What a mocap clip already drives. `full`: the whole body, so only a small
   * reactive head layer is added. `body`: pelvis, spine and legs (the weight
   * shift), so the arms and head here stay, the procedural sway does not.
   */
  mocap?: MocapLayer | null;
}

/** Body rotations for this instant. Every value is a pure function of the input. */
export function idlePose({ t, mode, loudness = 0, mocap = null }: IdleInput): BoneRotation[] {
  const inhale = breath(t);
  const sway = Math.sin((t / 9.5) * Math.PI * 2);
  const lively = mode === 'speaking' ? 1.6 : mode === 'listening' ? 1.15 : 1;
  const headYaw = drift(t * 0.6, 1) * 2.2 * DEG * lively;
  const headPitch = drift(t * 0.5, 2) * 1.4 * DEG * lively + loudness * 2.2 * DEG;
  const headRoll = drift(t * 0.4, 3) * 1.1 * DEG;
  const thinking = mode === 'thinking' ? 1 : 0;

  const head: BoneRotation[] = [
    { bone: 'neck_01', axis: Y, angle: headYaw * 0.4 },
    { bone: 'head', axis: Y, angle: headYaw * 0.6 + thinking * 6 * DEG },
    { bone: 'neck_01', axis: X, angle: headPitch * 0.4 },
    { bone: 'head', axis: X, angle: headPitch * 0.6 - thinking * 4 * DEG },
    { bone: 'head', axis: Z, angle: headRoll + thinking * 3 * DEG },
  ];
  if (mocap === 'full') {
    // The clip carries its own head motion; ours stays a small reactive layer.
    return head.map((rotation) => ({ ...rotation, angle: rotation.angle * 0.5 }));
  }

  const arms: BoneRotation[] = [
    // Arms hang naturally; a breath and the sway move them a little.
    { bone: 'upperarm_l', axis: Z, angle: -ARM_RELAX + inhale * 0.6 * DEG + sway * 0.5 * DEG },
    { bone: 'upperarm_r', axis: Z, angle: ARM_RELAX - inhale * 0.6 * DEG + sway * 0.5 * DEG },
    { bone: 'upperarm_l', axis: X, angle: -4 * DEG },
    { bone: 'upperarm_r', axis: X, angle: -4 * DEG },
    { bone: 'lowerarm_l', axis: X, angle: -(6 + drift(t, 4)) * DEG },
    { bone: 'lowerarm_r', axis: X, angle: -(6 + drift(t, 5)) * DEG },
    ...FOREARM_TWIST.flatMap(([bone, share]) =>
      (['l', 'r'] as const).map((side) => ({
        bone: `${bone}_${side}`,
        axis: 'twist' as const,
        angle: PRONATION * share,
      })),
    ),
    // Breathing lifts the shoulders slightly.
    { bone: 'clavicle_l', axis: Z, angle: inhale * 0.6 * DEG },
    { bone: 'clavicle_r', axis: Z, angle: -inhale * 0.6 * DEG },
  ];
  // Breathing: the chest lifts (small enough to sit on top of a clip's spine too).
  const chest: BoneRotation[] = [
    { bone: 'spine_03', axis: X, angle: -inhale * 0.7 * DEG },
    { bone: 'spine_05', axis: X, angle: inhale * 0.5 * DEG },
  ];
  if (mocap === 'body') return [...arms, ...chest, ...head];

  return [
    ...arms,
    ...chest,
    // Weight shift: pelvis rolls, the spine counters so the head stays level.
    { bone: 'pelvis', axis: Z, angle: sway * 1.1 * DEG },
    { bone: 'spine_01', axis: Z, angle: -sway * 0.7 * DEG },
    { bone: 'spine_03', axis: Z, angle: -sway * 0.4 * DEG },
    { bone: 'pelvis', axis: Y, angle: drift(t * 0.3, 6) * 1.2 * DEG },
    // Head: the neck carries a little, the head the rest; thinking tilts it.
    ...head,
  ];
}

export interface GazeState {
  /** Current eye direction offset (radians): yaw (+ to the character's left), pitch (+ up). */
  yaw: number;
  pitch: number;
  /** Fixation target the eyes jump to. */
  targetYaw: number;
  targetPitch: number;
  /** Seconds until the next saccade. */
  nextIn: number;
}

export function createGaze(): GazeState {
  return { yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0, nextIn: 1.2 };
}

/**
 * Saccades: the eyes hold a fixation for 0.6-2.8 s, then jump (~40 ms) to a new
 * one near the viewer. Thinking looks away and up, as people do when recalling.
 */
export function stepGaze(
  state: GazeState,
  dt: number,
  mode: LifeMode,
  random: () => number,
): GazeState {
  let { targetYaw, targetPitch, nextIn } = state;
  nextIn -= dt;
  if (nextIn <= 0) {
    const spread = mode === 'speaking' ? 3.5 : mode === 'listening' ? 2 : 4.5;
    targetYaw = (random() * 2 - 1) * spread * DEG;
    targetPitch = (random() * 2 - 1) * spread * 0.6 * DEG;
    if (mode === 'thinking') {
      targetYaw = (random() < 0.5 ? -1 : 1) * (9 + random() * 5) * DEG;
      targetPitch = (6 + random() * 4) * DEG;
    }
    nextIn = 0.6 + random() * 2.2;
  }
  // Saccades are fast: close most of the gap within a few frames.
  const k = 1 - Math.exp(-dt / 0.035);
  return {
    yaw: state.yaw + (targetYaw - state.yaw) * k,
    pitch: state.pitch + (targetPitch - state.pitch) * k,
    targetYaw,
    targetPitch,
    nextIn,
  };
}

/**
 * Lid-follow morph weights for an eye direction (ARKit eyeLook*). Eyelids track
 * the eyeball, which the joints rotate; without this the eyes look glassy.
 */
export function eyeLookMorphs(yaw: number, pitch: number): Record<string, number> {
  const range = 25 * DEG;
  const h = Math.max(-1, Math.min(1, yaw / range));
  const v = Math.max(-1, Math.min(1, pitch / range));
  // The character's left eye looks "out" when the gaze turns to its left (+yaw).
  return {
    eyeLookOutLeft: Math.max(0, h),
    eyeLookInLeft: Math.max(0, -h),
    eyeLookInRight: Math.max(0, h),
    eyeLookOutRight: Math.max(0, -h),
    eyeLookUpLeft: Math.max(0, v),
    eyeLookUpRight: Math.max(0, v),
    eyeLookDownLeft: Math.max(0, -v),
    eyeLookDownRight: Math.max(0, -v),
  };
}
