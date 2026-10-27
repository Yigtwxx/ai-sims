import { describe, expect, it } from 'vitest';

import { layoutFor, perStage, pointCountFor } from './layout';
import { LAST_STAGE } from './story';

describe('perStage', () => {
  it('blends neighbouring shapes and clamps at the ends', () => {
    expect(perStage([0, 1, 0], 0.5)).toBeCloseTo(0.5);
    expect(perStage([0, 1, 0], -1)).toBe(0);
    expect(perStage([0, 1, 0], 9)).toBe(0);
  });
});

describe('layoutFor', () => {
  it.each([
    [1440, 900],
    [390, 844],
  ])('keeps the silhouette inside a %ix%i screen', (width, height) => {
    const { centerY, scale, silScale } = layoutFor(width, height, LAST_STAGE);
    const half = silScale * scale;
    expect(centerY - half).toBeGreaterThan(0);
    expect(centerY + half).toBeLessThan(height);
  });
});

describe('pointCountFor', () => {
  it('halves the points on phones', () => {
    expect(pointCountFor(390)).toBe(pointCountFor(1440) / 2);
  });
});
