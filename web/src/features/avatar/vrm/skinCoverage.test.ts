import { describe, expect, it } from 'vitest';

import {
  computeCoveredVertices,
  computeVertexNormals,
  filterCoveredTriangles,
} from './skinCoverage';

const f32 = (...values: number[]) => Float32Array.from(values);
const LIMITS = { lateral: 0.02, inner: 0.04, outer: 0.03 };
const UP = f32(0, 1, 0);

describe('computeCoveredVertices', () => {
  it('covers skin under a garment above the surface', () => {
    const covered = computeCoveredVertices({
      skin: f32(0, 0, 0),
      normals: UP,
      garments: f32(0, 0.02, 0),
      ...LIMITS,
    });
    expect(covered[0]).toBe(1);
  });

  it('covers skin poking out of a tighter garment', () => {
    const covered = computeCoveredVertices({
      skin: f32(0, 0, 0),
      normals: UP,
      garments: f32(0, -0.03, 0),
      ...LIMITS,
    });
    expect(covered[0]).toBe(1);
  });

  it('keeps skin visible next to a garment edge (sideways offset)', () => {
    const covered = computeCoveredVertices({
      skin: f32(0, 0, 0),
      normals: UP,
      garments: f32(0.03, 0, 0),
      ...LIMITS,
    });
    expect(covered[0]).toBe(0);
  });

  it('ignores garments far above or below the skin', () => {
    const covered = computeCoveredVertices({
      skin: f32(0, 0, 0, 0, 0, 0),
      normals: f32(0, 1, 0, 0, 1, 0),
      garments: f32(0, 0.05, 0, 0, -0.06, 0),
      ...LIMITS,
    });
    expect([...covered]).toEqual([0, 0]);
  });

  it('handles negative coordinates across cell boundaries', () => {
    const covered = computeCoveredVertices({
      skin: f32(-0.5, -0.5, -0.5),
      normals: UP,
      garments: f32(-0.5, -0.49, -0.5),
      ...LIMITS,
    });
    expect(covered[0]).toBe(1);
  });
});

describe('computeVertexNormals', () => {
  it('points a counter-clockwise XZ triangle along +Y or -Y consistently', () => {
    const normals = computeVertexNormals(f32(0, 0, 0, 0, 0, 1, 1, 0, 0), [0, 1, 2]);
    expect(Math.abs(normals[1])).toBeCloseTo(1);
    expect(normals[1]).toBeCloseTo(normals[4]);
  });
});

describe('filterCoveredTriangles', () => {
  it('drops only fully covered triangles', () => {
    const index = [0, 1, 2, 1, 2, 3];
    const covered = Uint8Array.from([1, 1, 1, 0]);
    expect([...filterCoveredTriangles(index, covered)]).toEqual([1, 2, 3]);
  });
});
