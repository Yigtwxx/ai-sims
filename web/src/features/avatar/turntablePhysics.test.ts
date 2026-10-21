import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TURNTABLE_OPTIONS,
  applyDrag,
  createTurntableState,
  nearestFront,
  release,
  stepHome,
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

describe('turning back to the viewer', () => {
  it('picks the nearest whole turn, never the long way round', () => {
    expect(nearestFront(0.4)).toBe(0);
    expect(nearestFront(-2)).toBe(0);
    expect(nearestFront(Math.PI * 2 - 0.3)).toBeCloseTo(Math.PI * 2);
    expect(nearestFront(-Math.PI * 2 - 1)).toBeCloseTo(-Math.PI * 2);
  });

  it('glides there and settles exactly, without coasting', () => {
    let state = { ...createTurntableState(1.2), velocity: 0.05 };
    state = stepHome(state, 0, 1 / 60);
    expect(state.angle).toBeLessThan(1.2);
    expect(state.angle).toBeGreaterThan(0);
    expect(state.velocity).toBe(0);
    for (let i = 0; i < 240; i++) state = stepHome(state, 0, 1 / 60);
    expect(state.angle).toBe(0);
  });

  it('gives way to a drag', () => {
    const dragging = applyDrag(createTurntableState(1), 10);
    expect(stepHome(dragging, 0, 1 / 60)).toBe(dragging);
  });
});
