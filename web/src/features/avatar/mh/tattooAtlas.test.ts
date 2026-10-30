import { describe, expect, it } from 'vitest';

import { TATTOO_DESIGNS } from '@/features/creator/tattoos';

import { ATLAS_COLUMNS, ATLAS_ROWS, atlasCell } from './tattooAtlas';

describe('atlasCell', () => {
  it('fits every design in its own cell of the grid', () => {
    expect(ATLAS_COLUMNS * ATLAS_ROWS).toBeGreaterThanOrEqual(TATTOO_DESIGNS.length);
    const seen = new Set<string>();
    for (const design of TATTOO_DESIGNS) {
      const cell = atlasCell(design);
      expect(cell.u).toBeGreaterThanOrEqual(0);
      expect(cell.v).toBeGreaterThanOrEqual(0);
      expect(cell.u + cell.width).toBeLessThanOrEqual(1 + 1e-9);
      expect(cell.v + cell.height).toBeLessThanOrEqual(1 + 1e-9);
      seen.add(`${cell.u},${cell.v}`);
    }
    expect(seen.size).toBe(TATTOO_DESIGNS.length);
  });

  it('puts the first design at the top left (the canvas is flipped on upload)', () => {
    expect(atlasCell(TATTOO_DESIGNS[0])).toEqual({
      u: 0,
      v: 1 - 1 / ATLAS_ROWS,
      width: 1 / ATLAS_COLUMNS,
      height: 1 / ATLAS_ROWS,
    });
  });
});
