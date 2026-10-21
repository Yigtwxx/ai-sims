import { describe, expect, it } from 'vitest';

import { createEmphasis, stepEmphasis, type EmphasisState } from './emphasis';

const DT = 1 / 60;

function run(
  state: EmphasisState,
  seconds: number,
  loudness: number,
  speaking = true,
  random = () => 0,
): EmphasisState {
  for (let t = 0; t < seconds; t += DT) state = stepEmphasis(state, loudness, DT, speaking, random);
  return state;
}

describe('stepEmphasis', () => {
  it('nods and lifts the brows on a loudness onset, then settles', () => {
    let state = run(createEmphasis(), 1, 0.05);
    state = run(state, 0.12, 0.8);
    expect(state.nod).toBeGreaterThan(0.3);
    expect(state.brow).toBeGreaterThan(0.3);
    state = run(state, 1.5, 0.05);
    expect(state.nod).toBeLessThan(0.05);
  });

  it('does not keep nodding through steady loud speech', () => {
    const state = run(run(createEmphasis(), 0.2, 0.8), 2, 0.8);
    expect(state.nod).toBeLessThan(0.05);
  });

  it('stays still when not speaking', () => {
    const state = run(run(createEmphasis(), 1, 0.05, false), 0.2, 0.9, false);
    expect(state.nod).toBe(0);
  });

  it('skips the brow raise when the dice say so', () => {
    let state = run(createEmphasis(), 1, 0.05);
    state = run(state, 0.12, 0.8, true, () => 0.9);
    expect(state.nod).toBeGreaterThan(0.3);
    expect(state.brow).toBe(0);
  });
});
