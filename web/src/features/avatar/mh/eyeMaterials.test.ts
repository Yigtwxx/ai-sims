import { describe, expect, it } from 'vitest';

import { MH_EYE_OCCLUSION, eyeOcclusion, sideOcclusion } from './eyeMaterials';

describe('sideOcclusion', () => {
  it('is solid up to radius × hardness and gone past the radius', () => {
    const side = { radius: 0.4, hardness: 0.5 };
    expect(sideOcclusion(0.1, side)).toBe(1);
    expect(sideOcclusion(0.4, side)).toBe(0);
    const mid = sideOcclusion(0.3, side);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('is off for a zero radius', () => {
    expect(sideOcclusion(0, { radius: 0, hardness: 0 })).toBe(0);
  });
});

describe('eyeOcclusion', () => {
  it('shades the upper eyeball under the lid more than the lower', () => {
    expect(eyeOcclusion(0.5, 0.3)).toBeGreaterThan(eyeOcclusion(0.5, 0.8));
  });

  it('fades to nothing at the shell rim so the edge never shows on the skin', () => {
    expect(eyeOcclusion(0.5, 0)).toBe(0);
    expect(eyeOcclusion(1, 0.5)).toBe(0);
  });

  it('darkens the inner corner more than the outer one', () => {
    // Low on the eye, where the upper lid shadow is gone.
    expect(eyeOcclusion(0.8, 0.85)).toBeGreaterThan(eyeOcclusion(0.2, 0.85));
  });

  it('uses the strength chosen on the bench', () => {
    expect(MH_EYE_OCCLUSION.strength).toBeCloseTo(0.3);
  });
});
