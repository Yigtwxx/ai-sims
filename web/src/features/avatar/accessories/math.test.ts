import { describe, expect, it } from 'vitest';

import {
  bandRing,
  closedLength,
  convexHull2,
  createRadialMap,
  drapeLoop,
  eigenSymmetric3,
  fillRadialMap,
  offsetClosed,
  pointAtLength,
  polylineLength,
  principalAxes,
  radialAt,
  raycastSoup,
  resampleClosed,
  signedArea,
  splatTriangle,
  type Vec3,
} from './math';

function circle(radius: number, count: number, cx = 0, cy = 0): number[] {
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    return [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius];
  }).flat();
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe('principal axes', () => {
  it('diagonalizes a rotated symmetric matrix', () => {
    // R diag(3, 2, 1) R^T with R a 45 degree rotation about z.
    const c = Math.SQRT1_2;
    const m = [2.5, 0.5, 0, 0.5, 2.5, 0, 0, 0, 1];
    const { values, vectors } = eigenSymmetric3(m);
    expect(values[0]).toBeCloseTo(3);
    expect(values[1]).toBeCloseTo(2);
    expect(values[2]).toBeCloseTo(1);
    expect(Math.abs(dot(vectors[0], [c, c, 0]))).toBeCloseTo(1);
    expect(Math.abs(dot(vectors[2], [0, 0, 1]))).toBeCloseTo(1);
  });

  it('finds the normal of a flat patch as the least-variance axis', () => {
    const points: number[] = [];
    for (let i = 0; i < 200; i++) {
      const u = Math.cos(i * 1.7) * 0.02;
      const v = Math.sin(i * 2.3) * 0.03;
      // Plane spanned by (1, 1, 0) and (0, 0, 1); its normal is (1, -1, 0).
      points.push(u * Math.SQRT1_2 + 1, u * Math.SQRT1_2 + 2, v + 3);
    }
    const { mean, axes } = principalAxes(points);
    expect(mean[0]).toBeCloseTo(1, 2);
    expect(mean[2]).toBeCloseTo(3, 2);
    expect(Math.abs(dot(axes[2], [Math.SQRT1_2, -Math.SQRT1_2, 0]))).toBeCloseTo(1, 5);
  });
});

describe('closed rings', () => {
  it('wraps a convex hull around scattered points', () => {
    const square = [0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0.5, 0.2, 0.7];
    const hull = convexHull2(square);
    expect(hull).toHaveLength(8);
    expect(signedArea(hull)).toBeCloseTo(1);
  });

  it('resamples evenly and offsets outward', () => {
    const ring = resampleClosed(circle(1, 7), 64);
    expect(ring).toHaveLength(128);
    const grown = offsetClosed(resampleClosed(circle(0.05, 64), 64), 0.002);
    expect(closedLength(grown) / (2 * Math.PI)).toBeCloseTo(0.052, 3);
  });

  it('fits a band ring = radius + clearance around a cylinder section', () => {
    const points = [...circle(0.045, 90, 0.003, -0.002), ...circle(0.02, 30)];
    const ring = bandRing(points, 0.0015, 64);
    const radii = [];
    for (let i = 0; i < ring.length; i += 2)
      radii.push(Math.hypot(ring[i] - 0.003, ring[i + 1] + 0.002));
    for (const r of radii) expect(r).toBeCloseTo(0.0465, 3);
  });
});

describe('ray casting', () => {
  it('returns hits nearest first with barycentrics', () => {
    // Two parallel triangles at z = 0 and z = -1.
    const positions = [-1, -1, 0, 1, -1, 0, 0, 1, 0, -1, -1, -1, 1, -1, -1, 0, 1, -1];
    const index = [0, 1, 2, 3, 4, 5];
    const hits = raycastSoup(positions, index, [0, 0, 5], [0, 0, -1]);
    expect(hits.map((h) => h.triangle)).toEqual([0, 1]);
    expect(hits[0].t).toBeCloseTo(5);
    expect(hits[0].u + hits[0].v).toBeLessThanOrEqual(1);
    expect(raycastSoup(positions, index, [3, 3, 5], [0, 0, -1])).toHaveLength(0);
  });
});

/** Radial map of a vertical cylinder (radius r) that flares into a cone below y = 0. */
function neckAndShoulders(r: number, flare: number) {
  const map = createRadialMap(96, -0.2, 0.08, 0.004);
  const rows = 70;
  const cols = 48;
  const radiusAt = (y: number) => r + Math.max(0, -y) * flare;
  const vertex = (i: number, j: number): Vec3 => {
    const y = -0.2 + (j / rows) * 0.28;
    const a = (i / cols) * Math.PI * 2;
    return [Math.sin(a) * radiusAt(y), y, Math.cos(a) * radiusAt(y)];
  };
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      splatTriangle(map, vertex(i, j), vertex(i + 1, j), vertex(i, j + 1), 0.003);
      splatTriangle(map, vertex(i + 1, j), vertex(i + 1, j + 1), vertex(i, j + 1), 0.003);
    }
  }
  fillRadialMap(map);
  return { map, radiusAt };
}

describe('radial map and drape', () => {
  it('records the outer radius of a surface', () => {
    const { map } = neckAndShoulders(0.05, 1);
    expect(radialAt(map, 0.3, 0.04)).toBeCloseTo(0.05, 3);
    expect(radialAt(map, -2, -0.1)).toBeCloseTo(0.15, 2);
    expect(radialAt(map, 0, 0.5)).toBe(0);
  });

  it('settles a chain where the body is as wide as the loop', () => {
    const { map } = neckAndShoulders(0.05, 1);
    const clearance = 0.002;
    const length = 2 * Math.PI * 0.08;
    const nodes = drapeLoop(map, { length, nodes: 48, startY: 0.05, clearance });
    let meanY = 0;
    for (let i = 0; i < 48; i++) {
      const y = nodes[i * 3 + 1];
      const r = Math.hypot(nodes[i * 3], nodes[i * 3 + 2]);
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(
        radialAt(map, Math.atan2(nodes[i * 3], nodes[i * 3 + 2]), y) + clearance - 1e-4,
      );
      meanY += y / 48;
    }
    // Perimeter 2*pi*0.08 rests where r(y) + clearance = 0.08, i.e. y = -0.028.
    expect(meanY).toBeGreaterThan(-0.045);
    expect(meanY).toBeLessThan(-0.015);
    // Position-based links settle with a small residual stretch.
    expect(polylineLength(nodes, true)).toBeLessThanOrEqual(length * 1.02);
  });

  it('lets a pendant pull the front of the loop lowest', () => {
    const { map } = neckAndShoulders(0.05, 0.6);
    const nodes = drapeLoop(map, {
      length: 2 * Math.PI * 0.075,
      nodes: 40,
      startY: 0.05,
      clearance: 0.002,
      pendantMass: 12,
    });
    const ys = Array.from({ length: 40 }, (_, i) => nodes[i * 3 + 1]);
    expect(ys[0]).toBeCloseTo(Math.min(...ys), 6);
  });
});

describe('polylines', () => {
  it('walks a polyline by arc length', () => {
    const square = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
    expect(polylineLength(square, true)).toBeCloseTo(4);
    const p: Vec3 = [0, 0, 0];
    const t: Vec3 = [0, 0, 0];
    pointAtLength(square, true, 1.5, p, t);
    expect(p).toEqual([1, 0.5, 0]);
    expect(t).toEqual([0, 1, 0]);
  });
});
