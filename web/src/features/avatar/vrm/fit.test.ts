import { describe, expect, it } from 'vitest';

import { fitHeadProfiles, fitLimbProfiles, headProfile, limbProfile } from './fit';

const DEG = Math.PI / 180;

/** Points on a sphere around `centre` (flat xyz). */
function sphere(radius: number, centre: [number, number, number], heightScale = 1): number[] {
  const points: number[] = [];
  for (let el = -90; el <= 90; el += 5) {
    for (let az = -180; az < 180; az += 10) {
      const e = el * DEG;
      const a = az * DEG;
      points.push(
        centre[0] + radius * Math.sin(a) * Math.cos(e),
        centre[1] + radius * heightScale * Math.sin(e),
        centre[2] + radius * Math.cos(a) * Math.cos(e),
      );
    }
  }
  return points;
}

/** Points on a cylinder along +y from the joint (flat xyz). */
function cylinder(radius: number, length: number): number[] {
  const points: number[] = [];
  for (let t = 0; t <= length + 1e-9; t += length / 20) {
    for (let angle = -180; angle < 180; angle += 15) {
      points.push(radius * Math.cos(angle * DEG), t, radius * Math.sin(angle * DEG));
    }
  }
  return points;
}

const HEAD_RANGE = { min: 0.9, max: 1.2 };
const LIMB_RANGE = { min: 0.92, max: 1.3 };

describe('fitHeadProfiles', () => {
  it('scales hair by the skull ratio about the skull centre', () => {
    const base = headProfile(sphere(0.105, [0, 0.09, 0]))!;
    const source = headProfile(sphere(0.1, [0, 0.09, 0]))!;
    const fit = fitHeadProfiles(base, source, HEAD_RANGE)!;
    for (const s of fit.scale) expect(s).toBeCloseTo(1.05, 2);
    // Scaling about the centre: the joint-relative centre must not move.
    expect(fit.offset[1] + fit.scale[1] * 0.09).toBeCloseTo(0.09, 4);
  });

  it('grows mostly in height for a taller skull', () => {
    const base = headProfile(sphere(0.1, [0, 0.09, 0], 1.08))!;
    const source = headProfile(sphere(0.1, [0, 0.09, 0]))!;
    const fit = fitHeadProfiles(base, source, HEAD_RANGE)!;
    expect(fit.scale[1]).toBeGreaterThan(fit.scale[0]);
    expect(fit.scale[1]).toBeGreaterThan(1.04);
  });

  it('follows a skull that sits higher above the joint', () => {
    const base = headProfile(sphere(0.1, [0, 0.11, 0]))!;
    const source = headProfile(sphere(0.1, [0, 0.09, 0]))!;
    const fit = fitHeadProfiles(base, source, HEAD_RANGE)!;
    expect(fit.offset[1]).toBeCloseTo(0.02, 3);
  });

  it('returns nothing for identical skulls', () => {
    const skull = headProfile(sphere(0.1, [0, 0.09, 0]))!;
    expect(fitHeadProfiles(skull, skull, HEAD_RANGE)).toBeUndefined();
  });

  it('clamps extreme ratios to the range', () => {
    const base = headProfile(sphere(0.2, [0, 0.09, 0]))!;
    const source = headProfile(sphere(0.1, [0, 0.09, 0]))!;
    const fit = fitHeadProfiles(base, source, HEAD_RANGE)!;
    for (const s of fit.scale) expect(s).toBeLessThanOrEqual(HEAD_RANGE.max);
  });
});

describe('fitLimbProfiles', () => {
  it('grows girth by the body ratio and keeps the length', () => {
    const base = limbProfile(cylinder(0.055, 0.2), [0, 1, 0], 0.2)!;
    const source = limbProfile(cylinder(0.05, 0.2), [0, 1, 0], 0.2)!;
    const fit = fitLimbProfiles(base, source, LIMB_RANGE)!;
    expect(fit.scale[0]).toBeCloseTo(1.1, 2);
    expect(fit.scale[2]).toBeCloseTo(1.1, 2);
    expect(fit.scale[1]).toBe(1);
  });

  it('slims a garment for a slimmer body within the range', () => {
    const base = limbProfile(cylinder(0.047, 0.2), [0, 1, 0], 0.2)!;
    const source = limbProfile(cylinder(0.05, 0.2), [0, 1, 0], 0.2)!;
    const fit = fitLimbProfiles(base, source, LIMB_RANGE)!;
    expect(fit.scale[0]).toBeCloseTo(0.94, 2);
    expect(fit.scale[0]).toBeGreaterThanOrEqual(LIMB_RANGE.min);
  });
});
