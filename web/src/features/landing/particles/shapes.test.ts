import { describe, expect, it } from 'vitest';

import { buildParticles, PARAM_LAYOUT, PARAM_STRIDE, seededRandom } from './shapes';

describe('seededRandom', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });

  it('stays within 0..1', () => {
    const rnd = seededRandom(1);
    for (let i = 0; i < 1000; i++) {
      const value = rnd();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('buildParticles', () => {
  it('sizes every buffer for the point count', () => {
    const data = buildParticles(500);
    expect(data.dust).toHaveLength(1500);
    expect(data.sphere).toHaveLength(1500);
    expect(data.silhouette).toHaveLength(1500);
    expect(data.params).toHaveLength(500 * PARAM_STRIDE);
    expect(PARAM_LAYOUT).toHaveLength(PARAM_STRIDE);
  });

  it('is deterministic', () => {
    const a = buildParticles(300);
    const b = buildParticles(300);
    expect(a.dust).toEqual(b.dust);
    expect(a.params).toEqual(b.params);
  });

  it('puts sphere points on the unit sphere', () => {
    const { sphere } = buildParticles(400);
    for (let i = 0; i < 400; i++) {
      const length = Math.hypot(sphere[i * 3], sphere[i * 3 + 1], sphere[i * 3 + 2]);
      expect(length).toBeCloseTo(1, 5);
    }
  });

  it('falls back to the sphere without a silhouette', () => {
    const data = buildParticles(100);
    expect(data.silhouette).toEqual(data.sphere);
  });

  it('reuses a short silhouette so every point lands on the body', () => {
    const silhouette = new Float32Array([0, 1, 0, 0, -1, 0]);
    const { silhouette: body } = buildParticles(10, silhouette);
    for (let i = 0; i < 10; i++) {
      expect(Math.abs(Math.abs(body[i * 3 + 1]) - 1)).toBeLessThan(0.01);
    }
  });

  it('handles a single point', () => {
    const data = buildParticles(1);
    expect(Number.isFinite(data.sphere[1])).toBe(true);
    expect(Number.isFinite(data.params[2])).toBe(true);
  });
});
