import { describe, expect, it } from 'vitest';

import {
  TATTOO_ART,
  TATTOO_DESIGNS,
  TATTOO_FOCUS,
  TATTOO_PLACEMENTS,
  placementOfFocus,
} from './tattoos';

describe('TATTOO_ART', () => {
  it('draws every design with plain path commands inside its 100-unit box', () => {
    for (const design of TATTOO_DESIGNS) {
      const paths = TATTOO_ART[design];
      expect(paths.length, design).toBeGreaterThan(0);
      for (const d of paths) {
        expect(d, design).toMatch(/^M[\d\s.,MLCSQAZ-]+$/);
        const numbers = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
        for (const n of numbers) {
          expect(n, `${design}: ${d}`).toBeGreaterThanOrEqual(0);
          expect(n, `${design}: ${d}`).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});

describe('TATTOO_FOCUS', () => {
  it('gives each placement its own framing and finds the placement back', () => {
    const framings = new Set(Object.values(TATTOO_FOCUS));
    expect(framings.size).toBe(TATTOO_PLACEMENTS.length);
    for (const placement of TATTOO_PLACEMENTS) {
      expect(placementOfFocus(TATTOO_FOCUS[placement])).toBe(placement);
    }
  });
});
