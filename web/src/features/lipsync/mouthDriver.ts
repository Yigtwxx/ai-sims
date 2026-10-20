import { MathUtils } from 'three';

import { VISEMES, mpfbMorphName, type Viseme, type VisemeWeights } from './visemes';

/**
 * Applies viseme weights to morph-target meshes (MPFB / Oculus naming) with
 * per-channel smoothing, so frame-to-frame noise never makes the lips jitter.
 */

export interface MorphTarget {
  morphTargetDictionary?: Record<string, number>;
  morphTargetInfluences?: number[];
}

export type MouthState = Record<Viseme, number>;

export function createMouthState(): MouthState {
  return Object.fromEntries(VISEMES.map((v) => [v, 0])) as MouthState;
}

/** Fast attack keeps consonants crisp; a slightly slower release reads naturally. */
const ATTACK = 32;
const RELEASE = 20;

export function stepMouth(state: MouthState, target: VisemeWeights, dt: number): MouthState {
  for (const viseme of VISEMES) {
    const goal = target[viseme] ?? 0;
    const current = state[viseme];
    state[viseme] = MathUtils.damp(current, goal, goal > current ? ATTACK : RELEASE, dt);
  }
  return state;
}

export function applyMouthToMorphs(meshes: MorphTarget[], state: MouthState): void {
  for (const mesh of meshes) {
    const dict = mesh.morphTargetDictionary;
    const influences = mesh.morphTargetInfluences;
    if (!dict || !influences) continue;
    for (const viseme of VISEMES) {
      const index = dict[mpfbMorphName(viseme)];
      if (index !== undefined) influences[index] = state[viseme];
    }
  }
}
