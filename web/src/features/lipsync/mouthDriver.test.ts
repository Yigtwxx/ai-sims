import { describe, expect, it } from 'vitest';

import { applyMouthToMorphs, createMouthState, prioritizeClosures, stepMouth } from './mouthDriver';

describe('prioritizeClosures', () => {
  it('suppresses blended open shapes while the lips close', () => {
    const out = prioritizeClosures({ PP: 1, aa: 0.5 });
    expect(out.PP).toBe(1);
    expect(out.aa).toBe(0);
  });

  it('scales neighbours partially during a half closure', () => {
    const out = prioritizeClosures({ PP: 0.5, aa: 0.8 });
    expect(out.aa).toBeCloseTo(0.4);
  });

  it('keeps the lower lip at the teeth for f/v without hiding it entirely', () => {
    const out = prioritizeClosures({ FF: 1, E: 1 });
    expect(out.FF).toBe(1);
    expect(out.E).toBeCloseTo(0.3);
  });

  it('keeps every channel of a full mouth state', () => {
    const state = { ...createMouthState(), PP: 0.9, aa: 0.5 };
    const out = prioritizeClosures(state);
    expect(Object.keys(out).sort()).toEqual(Object.keys(state).sort());
    expect(out.aa).toBeCloseTo(0.05);
  });

  it('leaves weights untouched without closures', () => {
    const weights = { aa: 0.7, O: 0.2 };
    expect(prioritizeClosures(weights)).toBe(weights);
  });
});

describe('stepMouth and applyMouthToMorphs', () => {
  it('approaches the target without jumping and writes viseme morphs', () => {
    const state = createMouthState();
    stepMouth(state, { aa: 1 }, 1 / 60);
    expect(state.aa).toBeGreaterThan(0.2);
    expect(state.aa).toBeLessThan(1);
    const mesh = { morphTargetDictionary: { viseme_aa: 0 }, morphTargetInfluences: [0] };
    applyMouthToMorphs([mesh], state);
    expect(mesh.morphTargetInfluences[0]).toBeCloseTo(state.aa);
  });

  it('closes the lips faster than it opens a vowel', () => {
    const state = createMouthState();
    stepMouth(state, { PP: 1, aa: 1 }, 1 / 60);
    expect(state.PP).toBeGreaterThan(state.aa);
  });
});
