import { describe, expect, it } from 'vitest';

import {
  keepOuterShell,
  normalizeFigure,
  sampleSurfaces,
  seededRandom,
  tiltOf,
  turnToFaceViewer,
  type Surface,
} from './sampling';

/** A unit square in the z = 0 plane from (x0, y0), as two triangles. */
function square(name: string, x0: number, y0: number, size = 1, weight = 1): Surface {
  return {
    name,
    positions: new Float32Array([
      x0,
      y0,
      0,
      x0 + size,
      y0,
      0,
      x0 + size,
      y0 + size,
      0,
      x0,
      y0 + size,
      0,
    ]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    hidden: null,
    weight,
  };
}

describe('sampleSurfaces', () => {
  it('is reproducible for a seed', () => {
    const surfaces = [square('a', 0, 0)];
    const a = sampleSurfaces(surfaces, { count: 50, seed: 7 }).points;
    const b = sampleSurfaces(surfaces, { count: 50, seed: 7 }).points;
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('spreads points by area times weight', () => {
    // b is four times the area of a; c has a's area at half the density.
    const surfaces = [square('a', 0, 0), square('b', 2, 0, 2), square('c', 5, 0, 1, 0.5)];
    const { perSurface } = sampleSurfaces(surfaces, { count: 11000, seed: 1 });
    expect(perSurface[0]! / 11000).toBeCloseTo(2 / 11, 1);
    expect(perSurface[1]! / 11000).toBeCloseTo(8 / 11, 1);
    expect(perSurface[2]! / 11000).toBeCloseTo(1 / 11, 1);
  });

  it('doubles the density above the region line', () => {
    const surfaces = [square('low', 0, 0), square('high', 0, 2)];
    const { perSurface } = sampleSurfaces(surfaces, {
      count: 6000,
      seed: 3,
      region: { above: 1.5, weight: 2 },
    });
    expect(perSurface[1]! / perSurface[0]!).toBeCloseTo(2, 0);
  });

  it('never samples where the skin shader discards', () => {
    const skin = square('skin', 0, 0);
    // The right half of the square (x = 1 corners) is under clothes.
    skin.hidden = new Float32Array([0, 1, 1, 0]);
    const { points } = sampleSurfaces([skin], { count: 2000, seed: 5 });
    for (let i = 0; i < points.length; i += 3) expect(points[i]!).toBeLessThanOrEqual(0.5 + 1e-6);
  });

  it('skips triangles hidden at every corner', () => {
    const covered = square('covered', 0, 0);
    covered.hidden = new Float32Array([1, 1, 1, 1]);
    const { perSurface } = sampleSurfaces([covered, square('open', 3, 0)], {
      count: 500,
      seed: 2,
    });
    expect(perSurface).toEqual([0, 500]);
  });

  it('fails when nothing is visible', () => {
    const covered = square('covered', 0, 0);
    covered.hidden = new Float32Array([1, 1, 1, 1]);
    expect(() => sampleSurfaces([covered], { count: 10, seed: 1 })).toThrow();
  });
});

describe('keepOuterShell', () => {
  /** A small square facing +z at depth z, for shell tests (centre of the test head at z = -1). */
  const patch = (name: string, z: number, x0 = 0, shell = 'head'): Surface => {
    const surface = square(name, x0, 0, 0.1);
    for (let i = 2; i < surface.positions.length; i += 3) surface.positions[i] = z;
    return { ...surface, shell };
  };
  const options = {
    group: 'head',
    around: 'point',
    centre: [0.05, 0.05, -1],
    depth: 0.05,
    above: -10,
  } as const;

  it('drops what lies under the outermost layer in the same direction', () => {
    const [scalp, cards] = keepOuterShell([patch('scalp', 0), patch('cards', 0.2)], options);
    expect(scalp!.indices).toHaveLength(0);
    expect(cards!.indices).toHaveLength(6);
  });

  it('keeps layers within the depth and directions with nothing over them', () => {
    const kept = keepOuterShell(
      [patch('inner', 0.17), patch('outer', 0.2), patch('face', 0, 2)],
      options,
    );
    expect(kept.map((surface) => surface.indices.length)).toEqual([6, 6, 6]);
  });

  it('leaves surfaces outside the test and below the line alone', () => {
    const covered = patch('collar', 0, 0, 'waist');
    const low = patch('low', 0);
    const [collar, below] = keepOuterShell([covered, low, patch('cards', 0.2)], {
      ...options,
      above: 0.06,
    });
    expect(collar).toBe(covered);
    // Its triangles are centred at y ≈ 0.03 (below the line: kept) and 0.07 (under the cards: dropped).
    expect(below!.indices).toHaveLength(3);
  });

  it('compares slice by slice around a vertical axis', () => {
    // A waistband 10 cm inside a hem, and a pocket in another direction.
    const axisOptions = {
      ...options,
      group: 'waist',
      around: 'axis',
      above: -1,
      below: 1,
    } as const;
    const [band, hem, pocket] = keepOuterShell(
      [
        patch('band', 0.1, 0, 'waist'),
        patch('hem', 0.2, 0, 'waist'),
        patch('pocket', 0.15, 2, 'waist'),
      ],
      axisOptions,
    );
    expect([band, hem, pocket].map((surface) => surface!.indices.length)).toEqual([0, 6, 6]);
    expect(() => keepOuterShell([], { ...axisOptions, below: undefined })).toThrow();
  });
});

describe('seededRandom', () => {
  it('stays in [0, 1)', () => {
    const random = seededRandom(42);
    for (let i = 0; i < 1000; i += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('turnToFaceViewer', () => {
  it('leaves a chest that already faces +z', () => {
    expect(turnToFaceViewer([0.2, 1.4, 0], [-0.2, 1.4, 0])).toBeCloseTo(0, 6);
  });

  it('turns a chest facing +x back to +z', () => {
    // Facing +x, the character's left side is toward -z.
    const turn = turnToFaceViewer([0, 1.4, -0.2], [0, 1.4, 0.2]);
    // Forward (+x) turned about +y by `turn` (three's rotation) lands on +z.
    expect(Math.cos(turn) * 1).toBeCloseTo(0, 6);
    expect(-Math.sin(turn) * 1).toBeCloseTo(1, 6);
  });
});

describe('tiltOf', () => {
  it('reads the lean of a line in the front and side views', () => {
    expect(tiltOf([0, 0, 0], [0, 1, 0])).toEqual({ front: 0, side: 0 });
    const lean = tiltOf([0, 1, 0], [0.1, 2, -0.05]);
    expect(lean.front).toBeCloseTo((Math.atan(0.1) * 180) / Math.PI, 6);
    expect(lean.side).toBeCloseTo((Math.atan(-0.05) * 180) / Math.PI, 6);
  });
});

describe('normalizeFigure', () => {
  it('maps feet to -1 and the crown to 1, centred, at one scale', () => {
    const { points, height, centre } = normalizeFigure(
      new Float32Array([1, 0, 2, 1.4, 1.6, 2.2, 1.2, 0.8, 1.8]),
    );
    expect(height).toBeCloseTo(1.6, 6);
    expect(centre.x).toBeCloseTo(1.2, 6);
    expect(centre.z).toBeCloseTo(2, 6);
    expect(Array.from(points).map((v) => Number(v.toFixed(4)))).toEqual([
      -0.25, -1, 0, 0.25, 1, 0.25, 0, 0, -0.25,
    ]);
  });
});
