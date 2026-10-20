import { describe, expect, it } from 'vitest';

import { BLINK_DURATION, blinkCurve, nextBlinkInterval, stepBlink } from './life';

const fixedRandom = () => 0.5;

describe('blinkCurve', () => {
  it('is closed at the peak and open at both ends', () => {
    expect(blinkCurve(0)).toBe(0);
    expect(blinkCurve(0.35)).toBeCloseTo(1);
    expect(blinkCurve(1)).toBeCloseTo(0);
  });

  it('clamps out-of-range input', () => {
    expect(blinkCurve(-1)).toBe(0);
    expect(blinkCurve(2)).toBeCloseTo(0);
  });
});

describe('stepBlink', () => {
  it('counts down while eyes are open', () => {
    const { state, weight } = stepBlink({ nextIn: 1, phase: -1 }, 0.25, fixedRandom);
    expect(state.nextIn).toBeCloseTo(0.75);
    expect(weight).toBe(0);
  });

  it('starts a blink when the countdown ends', () => {
    const { state } = stepBlink({ nextIn: 0.1, phase: -1 }, 0.2, fixedRandom);
    expect(state.phase).toBe(0);
  });

  it('finishes the blink and schedules the next one', () => {
    const { state, weight } = stepBlink({ nextIn: 0, phase: 0.1 }, BLINK_DURATION, fixedRandom);
    expect(state.phase).toBe(-1);
    expect(state.nextIn).toBe(nextBlinkInterval(fixedRandom));
    expect(weight).toBe(0);
  });
});
