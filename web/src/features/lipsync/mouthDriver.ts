import { MathUtils } from 'three';

import { VISEMES, visemeMorphName, type Viseme, type VisemeWeights } from './visemes';

/**
 * Applies viseme weights to morph-target meshes (Oculus viseme naming) with
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

/**
 * Lets lip closures win over the shapes blended around them. Coarticulation
 * mixes the neighbours of an m/b/p into it, and morphs add up, so without this
 * the lips never quite meet; an f/v likewise needs the lower lip at the teeth.
 */
export function prioritizeClosures(weights: VisemeWeights): VisemeWeights {
  const seal = Math.min(1, weights.PP ?? 0);
  const bite = Math.min(1, weights.FF ?? 0) * 0.7;
  if (seal === 0 && bite === 0) return weights;
  const out: VisemeWeights = {};
  for (const [viseme, w] of Object.entries(weights) as [Viseme, number][]) {
    if (viseme === 'PP' || viseme === 'FF') out[viseme] = w;
    else out[viseme] = w * (1 - seal) * (1 - bite);
  }
  return out;
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
      const index = dict[visemeMorphName(viseme)];
      if (index !== undefined) influences[index] = state[viseme];
    }
  }
}
