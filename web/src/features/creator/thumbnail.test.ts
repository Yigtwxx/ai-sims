import { describe, expect, it } from 'vitest';

import { dataUrlBytes, portraitCrop } from './thumbnail';

describe('portraitCrop', () => {
  it('keeps a 3:4 crop inside the area right of the panel', () => {
    const crop = portraitCrop(2000, 1000, 600);
    expect(crop.width / crop.height).toBeCloseTo(0.75);
    expect(crop.x).toBeGreaterThanOrEqual(600);
    expect(crop.x + crop.width).toBeLessThanOrEqual(2000);
    expect(crop.y + crop.height).toBeLessThanOrEqual(1000);
  });

  it('shrinks to fit a narrow visible area', () => {
    const crop = portraitCrop(1000, 1000, 700);
    expect(crop.width).toBeLessThanOrEqual(300);
    expect(crop.width / crop.height).toBeCloseTo(0.75);
  });
});

describe('dataUrlBytes', () => {
  it('counts decoded bytes of a base64 payload', () => {
    expect(dataUrlBytes(`data:image/webp;base64,${btoa('abcd')}`)).toBe(4);
    expect(dataUrlBytes(`data:image/webp;base64,${btoa('abcde')}`)).toBe(5);
  });
});
