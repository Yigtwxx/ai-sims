import { describe, expect, it } from 'vitest';

import {
  IRIS_TINT_CHROMA,
  IRIS_TINT_STRENGTH,
  MH_EYE_OCCLUSION,
  eyeOcclusion,
  irisMask,
  muteTint,
  sideOcclusion,
  tintIris,
} from './eyeMaterials';

describe('irisMask', () => {
  it('covers the iris ring and leaves the pupil and sclera alone', () => {
    expect(irisMask(0)).toBe(0);
    expect(irisMask(0.03)).toBe(0);
    expect(irisMask(0.09)).toBe(1);
    expect(irisMask(0.16)).toBe(0);
  });

  it('fades across the limbus instead of cutting a hard ring', () => {
    const edge = irisMask(0.14);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(1);
  });
});

describe('tintIris', () => {
  const tint: [number, number, number] = [0.1, 0.25, 0.4];

  it('keeps the texel where the mask is off', () => {
    expect(tintIris([0.05, 0.03, 0.02], tint, 0.04, 0)).toEqual([0.05, 0.03, 0.02]);
  });

  it('gives an average iris texel the muted tint colour', () => {
    const texel: [number, number, number] = [0.04, 0.04, 0.04];
    const [r, g, b] = tintIris(texel, tint, 0.04, 1);
    const [mr, mg, mb] = muteTint(tint);
    const s = IRIS_TINT_STRENGTH;
    expect(r).toBeCloseTo(0.04 + (mr - 0.04) * s);
    expect(g).toBeCloseTo(0.04 + (mg - 0.04) * s);
    expect(b).toBeCloseTo(0.04 + (mb - 0.04) * s);
  });

  it('mutes the chroma but keeps the brightness of the picked colour', () => {
    const muted = muteTint(tint);
    const luma = (c: number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    expect(luma(muted)).toBeCloseTo(luma(tint));
    expect(muted[2] - muted[0]).toBeCloseTo((tint[2] - tint[0]) * IRIS_TINT_CHROMA);
  });

  it("keeps the iris fibres: a texel twice the iris's brightness gets twice the tint", () => {
    const dim = tintIris([0.02, 0.02, 0.02], tint, 0.02, 1);
    const bright = tintIris([0.04, 0.04, 0.04], tint, 0.02, 1);
    expect(bright[1] - 0.04 * (1 - IRIS_TINT_STRENGTH)).toBeCloseTo(
      2 * (dim[1] - 0.02 * (1 - IRIS_TINT_STRENGTH)),
    );
  });
});

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
