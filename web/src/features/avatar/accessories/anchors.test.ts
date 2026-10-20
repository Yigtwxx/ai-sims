import {
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';

import { crossSectionRing, findEars, meanRadius, SkinPin, weldedComponents } from './anchors';
import { sampleMesh } from './surface';

/** A head-like sphere plus optional flat ear shells, positions in head-frame coordinates. */
function syntheticHead(separateEars: boolean) {
  const positions: number[] = [];
  const index: number[] = [];
  const sphere = new SphereGeometry(0.09, 32, 24).toNonIndexed();
  const sp = sphere.getAttribute('position');
  for (let i = 0; i < sp.count; i++) {
    // Skull centre sits behind the eye-midpoint origin.
    positions.push(sp.getX(i), sp.getY(i) + 0.02, sp.getZ(i) - 0.04);
    index.push(i);
  }
  if (separateEars) {
    for (const side of [1, -1]) {
      // An oval shell, 6 cm tall, standing out from the side of the head.
      const base = positions.length / 3;
      const rows = 6;
      const cols = 8;
      for (let r = 0; r <= rows; r++) {
        for (let c = 0; c <= cols; c++) {
          const y = -0.045 + (r / rows) * 0.06;
          const z = -0.06 + (c / cols) * 0.035;
          positions.push(side * (0.092 + 0.012 * (c / cols)), y, z);
        }
      }
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const a = base + r * (cols + 1) + c;
          index.push(a, a + 1, a + cols + 1, a + 1, a + cols + 2, a + cols + 1);
        }
      }
    }
  }
  return { positions: new Float32Array(positions), index };
}

describe('ears', () => {
  it('welds coincident vertices into connected components', () => {
    const { positions, index } = syntheticHead(true);
    const sizes = weldedComponents(positions, index)
      .map((group) => group.length)
      .sort((a, b) => b - a);
    expect(sizes).toHaveLength(3);
    expect(sizes[1]).toBe(63);
  });

  it('finds separate ear shells and their lobes', () => {
    const { positions, index } = syntheticHead(true);
    const { left, right } = findEars(positions, index);
    expect(left && right).toBeTruthy();
    expect(left!.side).toBe(1);
    expect(left!.bottom).toBeCloseTo(-0.045, 5);
    expect(left!.top).toBeCloseTo(0.015, 5);
    expect(left!.lobe[0]).toBeGreaterThan(0.09);
    expect(left!.lobe[1]).toBeLessThan(-0.035);
    expect(right!.lobe[0]).toBeLessThan(-0.09);
    // Shells lie in planes facing mostly sideways; normals point outward.
    expect(left!.normal[0]).toBeGreaterThan(0.9);
    expect(right!.normal[0]).toBeLessThan(-0.9);
  });

  it('falls back to the lateral extreme when ears are welded to the head', () => {
    const { positions, index } = syntheticHead(false);
    const { left, right } = findEars(positions, index);
    expect(left!.lobe[0]).toBeGreaterThan(0.07);
    expect(right!.lobe[0]).toBeLessThan(-0.07);
  });
});

describe('cross-section rings', () => {
  it('rings a cylindrical neck at radius + clearance', () => {
    const points: number[] = [];
    for (let k = 0; k < 9; k++) {
      for (let i = 0; i < 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        points.push(Math.cos(a) * 0.05, Math.sin(a) * 0.05, -0.04 + k * 0.01);
      }
    }
    // Points far outside the slab (a shoulder) must not widen the band.
    points.push(0.2, 0, 0.05);
    const ring = crossSectionRing(points, 0.012, 0.0015);
    expect(ring.length).toBe(128);
    expect(meanRadius(ring)).toBeCloseTo(0.0515, 3);
    expect(crossSectionRing([0, 0, 1], 0.01, 0.001)).toEqual([]);
  });
});

describe('skin pins', () => {
  it('follow morph targets and keep the outward normal', () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute([0, 0, 0, 0.01, 0, 0, 0, 0.01, 0], 3),
    );
    geometry.setIndex([0, 1, 2]);
    // The morph pushes the whole triangle 5 mm forward (like a pout).
    geometry.morphAttributes.position = [
      new Float32BufferAttribute([0, 0, 0.005, 0.01, 0, 0.005, 0, 0.01, 0.005], 3),
    ];
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    mesh.position.set(0, 1.5, 0);
    mesh.updateMatrixWorld(true);
    const surface = sampleMesh(mesh, () => 'face');
    const pin = SkinPin.nearest(surface, new Vector3(0.003, 1.503, 0.002), new Vector3(0, 0, -1))!;

    const position = new Vector3();
    const normal = new Vector3();
    pin.evaluate(position, normal);
    expect(position.x).toBeCloseTo(0.003, 6);
    expect(position.y).toBeCloseTo(1.503, 6);
    expect(position.z).toBeCloseTo(0, 6);
    expect(normal.z).toBeCloseTo(-1, 6);

    mesh.morphTargetInfluences![0] = 1;
    pin.evaluate(position, normal);
    expect(position.z).toBeCloseTo(0.005, 6);
  });
});
