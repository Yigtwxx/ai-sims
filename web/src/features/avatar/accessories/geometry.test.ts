import { BufferGeometry, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import {
  bevelledSolid,
  brilliant,
  chainLink,
  circleProfile,
  crescentShape,
  dProfile,
  facetedStar,
  heartShape,
  lathe,
  merge,
  pearOutline,
  roundedRectProfile,
  smoothPath,
  sweep,
  transportNormals,
  triangleCount,
  wire,
} from './geometry';
import { signedArea } from './math';

function finite(geometry: BufferGeometry): boolean {
  for (const name of ['position', 'normal']) {
    const attribute = geometry.getAttribute(name);
    if (!attribute) continue;
    for (let i = 0; i < attribute.array.length; i++) {
      if (!Number.isFinite(attribute.array[i])) return false;
    }
  }
  return true;
}

function size(geometry: BufferGeometry): Vector3 {
  geometry.computeBoundingBox();
  return geometry.boundingBox!.getSize(new Vector3());
}

/** Divergence-theorem volume; positive when triangles wind outward. */
function signedVolume(geometry: BufferGeometry): number {
  const position = geometry.getAttribute('position');
  const index = geometry.index;
  const count = index ? index.count : position.count;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  let volume = 0;
  for (let t = 0; t < count; t += 3) {
    a.fromBufferAttribute(position, index ? index.getX(t) : t);
    b.fromBufferAttribute(position, index ? index.getX(t + 1) : t + 1);
    c.fromBufferAttribute(position, index ? index.getX(t + 2) : t + 2);
    volume += a.dot(b.clone().cross(c)) / 6;
  }
  return volume;
}

const ringPath = (radius: number, count: number) =>
  Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    return new Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0);
  });

describe('profiles', () => {
  it('are closed counter-clockwise loops', () => {
    for (const profile of [
      circleProfile(0.001, 8),
      roundedRectProfile(0.003, 0.002, 0.0005),
      dProfile(0.002, 0.004),
    ]) {
      expect(signedArea(profile.flat())).toBeGreaterThan(0);
    }
  });
});

describe('sweeps', () => {
  it('builds a closed, outward-facing tube around a ring', () => {
    const torus = sweep({
      path: ringPath(0.01, 48),
      closed: true,
      profile: circleProfile(0.001, 8),
    });
    expect(finite(torus)).toBe(true);
    const box = size(torus);
    expect(box.x).toBeCloseTo(0.022, 3);
    expect(box.z).toBeCloseTo(0.002, 3);
    // 2 pi^2 R r^2, slightly less for the polygonal approximation.
    expect(signedVolume(torus)).toBeGreaterThan(1.7e-7);
    expect(signedVolume(torus)).toBeLessThan(2.0e-7);
  });

  it('keeps transported normals perpendicular to the path', () => {
    const path = smoothPath(
      [new Vector3(0, 0, 0), new Vector3(0.01, 0.005, 0), new Vector3(0.02, 0, 0.004)],
      false,
      24,
    );
    const normals = transportNormals(path, false, new Vector3(0, 1, 0));
    for (let i = 1; i < path.length - 1; i++) {
      const tangent = path[i + 1]
        .clone()
        .sub(path[i - 1])
        .normalize();
      expect(Math.abs(normals[i].dot(tangent))).toBeLessThan(1e-6);
      expect(normals[i].length()).toBeCloseTo(1, 6);
    }
  });

  it('caps open sweeps and builds smooth wires', () => {
    const bar = sweep({
      path: [new Vector3(0, 0, 0), new Vector3(0, 0, 0.01)],
      closed: false,
      profile: circleProfile(0.0008, 10),
      caps: true,
    });
    expect(signedVolume(bar)).toBeGreaterThan(0);
    const pin = wire(
      [new Vector3(0, 0, 0), new Vector3(0.01, 0.002, 0), new Vector3(0.02, 0, 0)],
      0.0004,
    );
    expect(finite(pin)).toBe(true);
    // End sections are tilted with the tangent, so they add little to the x extent.
    expect(size(pin).x).toBeCloseTo(0.0202, 3);
  });
});

describe('jewellery pieces', () => {
  it('chain links have the pitch as inner length and a small triangle budget', () => {
    const link = chainLink(0.003, 0.002, 0.0004, 8, 4);
    const box = size(link);
    // Outer size = inner size + two wire diameters.
    expect(box.z).toBeCloseTo(0.003 + 4 * 0.0004, 6);
    expect(box.x).toBeCloseTo(0.002 + 4 * 0.0004, 4);
    expect(box.y).toBeCloseTo(0.0008, 6);
    expect(triangleCount(link)).toBe(160);
    expect(signedVolume(link)).toBeGreaterThan(0);
  });

  it('cuts round and pear brilliants with outward facets', () => {
    const round = brilliant(0.006);
    const box = size(round);
    expect(box.x).toBeCloseTo(0.006, 4);
    expect(box.z).toBeCloseTo(0.006 * (0.16 + 0.43), 4);
    expect(signedVolume(round)).toBeGreaterThan(0);
    expect(triangleCount(round)).toBeLessThan(140);

    const pear = brilliant(0.008, { outline: pearOutline, elongation: 1.4 });
    expect(finite(pear)).toBe(true);
    expect(size(pear).y).toBeGreaterThan(size(pear).x);
    expect(signedVolume(pear)).toBeGreaterThan(0);
  });

  it('builds a faceted star', () => {
    const star = facetedStar(0.006, 0.0026, 0.002);
    const box = size(star);
    expect(box.y).toBeGreaterThan(0.01);
    expect(box.z).toBeCloseTo(0.002, 5);
    expect(signedVolume(star)).toBeGreaterThan(0);
  });

  it('puffs hearts and crescents into centred solids', () => {
    for (const shape of [heartShape(0.012), crescentShape(0.012)]) {
      const solid = bevelledSolid(shape, 0.0015, 0.0012);
      expect(finite(solid)).toBe(true);
      const box = size(solid);
      expect(box.y).toBeGreaterThan(0.01);
      expect(box.y).toBeLessThan(0.016);
      expect(box.z).toBeCloseTo(0.0015 + 2 * 0.0012, 4);
      solid.computeBoundingBox();
      const centre = solid.boundingBox!.getCenter(new Vector3());
      expect(centre.length()).toBeLessThan(1e-6);
      expect(signedVolume(solid)).toBeGreaterThan(0);
    }
  });

  it('lathes and merges', () => {
    const cup = lathe(
      [
        [0, 0],
        [0.002, 0],
        [0.0025, 0.001],
      ],
      16,
    );
    const link = chainLink(0.003, 0.002, 0.0004);
    const vertices = cup.getAttribute('position').count + link.getAttribute('position').count;
    const merged = merge([cup, link]);
    expect(merged.getAttribute('position').count).toBe(vertices);
    expect(finite(merged)).toBe(true);
  });
});
