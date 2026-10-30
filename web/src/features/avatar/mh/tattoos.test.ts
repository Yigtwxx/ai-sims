import { BufferAttribute, BufferGeometry, MeshBasicMaterial, SkinnedMesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { TATTOO_PLACEMENTS } from '@/features/creator/tattoos';

import { BODY_HIDDEN } from './garments';
import type { RestSample } from './restPose';
import { LEG_HEIGHT } from './socks';
import {
  TATTOO_UV,
  castToSkin,
  decalFrame,
  decalUv,
  hidesTattoo,
  patchGeometry,
  placementRay,
  tattooMaterial,
  type PlacementRay,
  type WornTattoo,
} from './tattoos';

/** A flat square of skin in the z = 0 plane facing +z, `cells` x `cells` quads. */
function sheet(size: number, cells: number, lift?: (x: number, y: number) => number) {
  const positions: number[] = [];
  const index: number[] = [];
  for (let j = 0; j <= cells; j += 1) {
    for (let i = 0; i <= cells; i += 1) {
      const x = (i / cells - 0.5) * size;
      const y = (j / cells - 0.5) * size;
      positions.push(x, y, lift ? lift(x, y) : 0);
    }
  }
  const row = cells + 1;
  for (let j = 0; j < cells; j += 1) {
    for (let i = 0; i < cells; i += 1) {
      const a = j * row + i;
      index.push(a, a + 1, a + row + 1, a, a + row + 1, a + row);
    }
  }
  const geometry = new BufferGeometry();
  const count = positions.length / 3;
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(count * 3).fill(0), 3));
  geometry.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(count * 4), 4));
  geometry.setAttribute(
    'skinWeight',
    new BufferAttribute(
      Float32Array.from({ length: count * 4 }, (_, k) => (k % 4 ? 0 : 1)),
      4,
    ),
  );
  geometry.setAttribute(BODY_HIDDEN, new BufferAttribute(new Float32Array(count), 1));
  geometry.setAttribute(LEG_HEIGHT, new BufferAttribute(new Float32Array(count).fill(1), 1));
  geometry.morphAttributes.position = [
    new BufferAttribute(
      Float32Array.from({ length: count * 3 }, (_, k) => k % 3),
      3,
    ),
  ];
  geometry.setIndex(index);
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
  const sample: RestSample = {
    mesh,
    positions: Float32Array.from(positions),
    sampled: new Uint8Array(count).fill(1),
  };
  return { mesh, sample };
}

const outOfSheet = (size = 0.03): PlacementRay => ({
  origin: new Vector3(0, 0, -0.02),
  direction: new Vector3(0, 0, 1),
  up: new Vector3(0, 1, 0),
  size,
});

describe('placementRay', () => {
  // A standing body facing +z, its left along +x (metres, rest pose).
  const joints: Record<string, [number, number, number]> = {
    upperarm_l: [0.16, 1.32, -0.02],
    upperarm_r: [-0.16, 1.32, -0.02],
    lowerarm_l: [0.3, 1.05, -0.02],
    hand_l: [0.36, 0.8, 0.0],
    index_01_l: [0.37, 0.72, 0.04],
    pinky_01_l: [0.4, 0.73, -0.02],
    middle_01_l: [0.38, 0.71, 0.01],
    thumb_01_l: [0.35, 0.76, 0.04],
    lowerarm_r: [-0.3, 1.05, -0.02],
    hand_r: [-0.36, 0.8, 0.0],
    index_01_r: [-0.37, 0.72, 0.04],
    pinky_01_r: [-0.4, 0.73, -0.02],
    middle_01_r: [-0.38, 0.71, 0.01],
    thumb_01_r: [-0.35, 0.76, 0.04],
    spine_05: [0, 1.24, 0],
    neck_01: [0, 1.4, -0.02],
    foot_l: [0.13, 0.08, 0],
    FACIAL_R_Ear: [-0.067, 1.6, 0.004],
  };
  const lookup = (name: string) => {
    const joint = joints[name];
    return joint ? new Vector3(...joint) : null;
  };

  it('finds every placement on a full skeleton, with unit directions', () => {
    for (const placement of TATTOO_PLACEMENTS) {
      const ray = placementRay(placement, lookup);
      expect(ray, placement).not.toBeNull();
      expect(ray!.direction.length()).toBeCloseTo(1, 6);
      expect(ray!.size).toBeGreaterThan(0.01);
      expect(ray!.size).toBeLessThan(0.06);
    }
  });

  it('aims back placements backwards and the ankle outwards', () => {
    expect(placementRay('nape', lookup)!.direction.z).toBeLessThan(-0.9);
    expect(placementRay('shoulderBlade', lookup)!.direction.z).toBeLessThan(-0.9);
    expect(placementRay('shoulderBlade', lookup)!.origin.x).toBeLessThan(0);
    const ankle = placementRay('ankle', lookup)!;
    expect(ankle.direction.x).toBeGreaterThan(0.8);
    expect(placementRay('behindEar', lookup)!.direction.x).toBeLessThan(0);
  });

  it('puts the forearm designs upright towards the elbow', () => {
    const wrist = placementRay('innerWrist', lookup)!;
    const towardsElbow = new Vector3(...joints.lowerarm_l!).sub(new Vector3(...joints.hand_l!));
    expect(wrist.up.dot(towardsElbow.normalize())).toBeCloseTo(1, 6);
    expect(Math.abs(wrist.direction.dot(wrist.up))).toBeLessThan(1e-6);
  });

  it('gives up without the joints it needs', () => {
    expect(placementRay('nape', () => null)).toBeNull();
    expect(
      placementRay('behindEar', (name) => (name === 'FACIAL_R_Ear' ? null : lookup(name))),
    ).toBeNull();
  });
});

describe('decal coordinates', () => {
  it('builds a right-handed frame on the skin with its top up', () => {
    const { right, top } = decalFrame(new Vector3(0, 0, 1), new Vector3(0, 1, 0.3));
    expect(top.toArray().map((v) => +v.toFixed(6))).toEqual([0, 1, 0]);
    expect(right.toArray().map((v) => +v.toFixed(6))).toEqual([1, 0, 0]);
  });

  it('maps the spot to the middle and the design size to the unit square', () => {
    const normal = new Vector3(0, 0, 1);
    const frame = decalFrame(normal, new Vector3(0, 1, 0));
    const at = (x: number, y: number) =>
      decalUv(new Vector3(x, y, 0), new Vector3(), normal, frame, 0.04, [0, 0]);
    expect(at(0, 0)).toEqual([0.5, 0.5]);
    expect(at(0.02, 0)[0]).toBeCloseTo(1, 6);
    expect(at(0, -0.02)[1]).toBeCloseTo(0, 6);
  });

  it('stretches a point on a curved limb to its straight distance', () => {
    const normal = new Vector3(0, 0, 1);
    const frame = decalFrame(normal, new Vector3(0, 1, 0));
    // 2 cm out along a skin that falls away 1 cm: chord length, not its shadow.
    const [u] = decalUv(new Vector3(0.02, 0, -0.01), new Vector3(), normal, frame, 0.04, [0, 0]);
    expect(u).toBeCloseTo(0.5 + Math.hypot(0.02, 0.01) / 0.04, 6);
  });
});

describe('castToSkin', () => {
  it('hits the sheet where the ray leaves the body, normal outward', () => {
    const { sample } = sheet(0.1, 10);
    const hit = castToSkin([sample], {
      ...outOfSheet(),
      origin: new Vector3(0.012, -0.007, -0.02),
    });
    expect(hit).not.toBeNull();
    expect(hit!.point.x).toBeCloseTo(0.012, 6);
    expect(hit!.point.y).toBeCloseTo(-0.007, 6);
    expect(hit!.normal.z).toBeCloseTo(1, 6);
    expect(hit!.sample).toBe(sample);
    // Wound so that its own cross product points out of the skin.
    const [a, b, c] = hit!.corners.map((v) => new Vector3().fromArray(sample.positions, v * 3));
    expect(b!.clone().sub(a!).cross(c!.clone().sub(a!)).z).toBeGreaterThan(0);
  });

  it('misses skin it was not sampled for', () => {
    const { sample } = sheet(0.1, 10);
    sample.sampled.fill(0);
    expect(castToSkin([sample], outOfSheet())).toBeNull();
  });
});

describe('patchGeometry', () => {
  it('copies the triangles under the design with their skin, morphs and coordinates', () => {
    const { sample } = sheet(0.2, 40);
    const ray = outOfSheet(0.03);
    const hit = castToSkin([sample], ray)!;
    const patch = patchGeometry(sample, hit, ray)!;
    const triangles = patch.index!.count / 3;
    // Centres within 0.8 x the design (2.4 cm): about 18 cm^2 of 0.25 cm^2 quads, two triangles each.
    expect(triangles).toBeGreaterThan(130);
    expect(triangles).toBeLessThan(160);
    const count = patch.getAttribute('position').count;
    for (const name of ['normal', 'skinIndex', 'skinWeight', BODY_HIDDEN, LEG_HEIGHT, TATTOO_UV]) {
      expect(patch.getAttribute(name)?.count, name).toBe(count);
    }
    expect(patch.getAttribute('skinIndex').array).toBeInstanceOf(Uint16Array);
    expect(patch.morphAttributes.position?.[0]?.count).toBe(count);
    const source = patch.userData.tattooSource as Uint32Array;
    const uv = patch.getAttribute(TATTOO_UV);
    for (let n = 0; n < count; n += 1) {
      const x = sample.positions[source[n]! * 3]!;
      expect(uv.getX(n)).toBeCloseTo(x / 0.03 + 0.5, 4);
    }
  });

  it('leaves out skin standing beside the spot (the back of an ear)', () => {
    const { sample } = sheet(0.1, 20, (x) => (x > 0.008 ? 0.01 : 0));
    const ray = outOfSheet(0.03);
    const patch = patchGeometry(sample, castToSkin([sample], ray)!, ray)!;
    const source = patch.userData.tattooSource as Uint32Array;
    for (const vertex of source) expect(sample.positions[vertex * 3 + 2]).toBeLessThan(0.005);
  });
});

describe('hidesTattoo', () => {
  it('is true when a garment mask covers any of the body patch', () => {
    const { mesh, sample } = sheet(0.1, 10);
    const ray = outOfSheet();
    const geometry = patchGeometry(sample, castToSkin([sample], ray)!, ray)!;
    const patch = new SkinnedMesh(geometry, tattooMaterial('star', true));
    patch.skeleton = mesh.skeleton;
    const tattoo: WornTattoo = { wear: { design: 'star', placement: 'nape' }, patches: [patch] };
    const hide = new Uint8Array(sample.sampled.length);
    expect(hidesTattoo(hide, tattoo, mesh)).toBe(false);
    hide[(geometry.userData.tattooSource as Uint32Array)[0]!] = 1;
    expect(hidesTattoo(hide, tattoo, mesh)).toBe(true);
    expect(hidesTattoo(null, tattoo, mesh)).toBe(false);
  });
});
