import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TURNTABLE_OPTIONS,
  applyDrag,
  createTurntableState,
  release,
  stepTurntable,
} from './turntablePhysics';

describe('turntable', () => {
  it('rotates proportionally to drag distance', () => {
    const next = applyDrag(createTurntableState(), 100);
    expect(next.angle).toBeCloseTo(100 * DEFAULT_TURNTABLE_OPTIONS.sensitivity);
    expect(next.dragging).toBe(true);
  });

  it('does not coast while dragging', () => {
    const dragging = applyDrag(createTurntableState(), 50);
    expect(stepTurntable(dragging, 1 / 60)).toBe(dragging);
  });

  it('keeps rotating after release and slows down', () => {
    const released = release(applyDrag(createTurntableState(), 50));
    const a = stepTurntable(released, 1 / 60);
    const b = stepTurntable(a, 1 / 60);
    expect(a.angle).toBeGreaterThan(released.angle);
    expect(Math.abs(b.velocity)).toBeLessThan(Math.abs(a.velocity));
  });

  it('damping is frame-rate independent', () => {
    const released = release(applyDrag(createTurntableState(), 50));
    const oneStep = stepTurntable(released, 2 / 60);
    const twoSteps = stepTurntable(stepTurntable(released, 1 / 60), 1 / 60);
    expect(oneStep.velocity).toBeCloseTo(twoSteps.velocity, 10);
  });

  it('comes to rest', () => {
    let state = release(applyDrag(createTurntableState(), 10));
    for (let i = 0; i < 600; i++) state = stepTurntable(state, 1 / 60);
    expect(state.velocity).toBe(0);
  });
});
