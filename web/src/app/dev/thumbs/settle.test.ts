import { describe, expect, it } from 'vitest';

import { centreDetail, GRID, lumaOf, meanDifference, nextCalm, SETTLE_RULE } from './settle';

const flat = (value: number) => new Float32Array(GRID * GRID).fill(value);

/** A checkerboard: lots of detail in the centre. */
const busy = () => {
  const luma = new Float32Array(GRID * GRID);
  for (let i = 0; i < luma.length; i += 1) luma[i] = (i + Math.floor(i / GRID)) % 2 ? 200 : 40;
  return luma;
};

describe('settle', () => {
  it('reads luma from RGBA', () => {
    expect(lumaOf(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]))).toEqual(
      new Float32Array([255, 0]),
    );
  });

  it('sees no detail on a flat backdrop and plenty on a pattern', () => {
    expect(centreDetail(flat(30))).toBe(0);
    expect(centreDetail(busy())).toBeGreaterThan(SETTLE_RULE.minDetail);
  });

  it('measures the difference between samples', () => {
    expect(meanDifference(flat(10), flat(13))).toBe(3);
    expect(meanDifference(flat(10), new Float32Array(4))).toBe(Number.POSITIVE_INFINITY);
  });

  it('counts calm samples only when assets are quiet and the stage shows something', () => {
    const luma = busy();
    expect(nextCalm(2, { luma, previous: luma, sinceAssetMs: 200 })).toBe(0);
    expect(nextCalm(2, { luma: flat(30), previous: flat(30), sinceAssetMs: 5000 })).toBe(0);
    expect(nextCalm(0, { luma, previous: null, sinceAssetMs: 5000 })).toBe(0);
    expect(nextCalm(2, { luma, previous: luma, sinceAssetMs: 5000 })).toBe(3);
    const moved = luma.map((value) => value + 40);
    expect(nextCalm(2, { luma, previous: moved, sinceAssetMs: 5000 })).toBe(0);
  });
});
