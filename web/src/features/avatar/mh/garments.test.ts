import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  Group,
  MeshStandardMaterial,
  Skeleton,
  SkinnedMesh,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';

import { applyBodySliders, createBodyRig, type NeckSeamBinding } from './assembly';
import {
  applyBodyHide,
  BODY_HIDDEN,
  bindGarment,
  decodeHideBitset,
  fitGarmentOverHead,
  skinGarmentToHead,
  syncGarmentMorphs,
} from './garments';

function skinned(bones: Bone[], joints: number[], morphs: string[] = []): SkinnedMesh {
  const geometry = new BufferGeometry();
  const count = joints.length;
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute(
    'skinIndex',
    new BufferAttribute(Uint16Array.from(joints.flatMap((j) => [j, 0, 0, 0])), 4),
  );
  geometry.setAttribute(
    'skinWeight',
    new BufferAttribute(Float32Array.from(joints.flatMap(() => [1, 0, 0, 0])), 4),
  );
  geometry.morphAttributes.position = morphs.map(
    () => new BufferAttribute(new Float32Array(count * 3), 3),
  );
  const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial());
  mesh.morphTargetDictionary = Object.fromEntries(morphs.map((name, i) => [name, i]));
  mesh.morphTargetInfluences = morphs.map(() => 0);
  mesh.bind(new Skeleton(bones));
  return mesh;
}

function bone(name: string, parent?: Bone): Bone {
  const b = new Bone();
  b.name = name;
  parent?.add(b);
  return b;
}

function rig() {
  const root = new Group();
  const pelvis = bone('pelvis');
  const spine = bone('spine_01', pelvis);
  root.add(pelvis);
  const body = skinned([pelvis, spine], [0, 1, 1], ['body_weight_max', 'body_height_min']);
  root.add(body);
  root.updateMatrixWorld(true);
  return createBodyRig(root, {});
}

describe('bindGarment', () => {
  it('remaps skin indices to the body joint order and shares its skeleton', () => {
    const body = rig();
    // The garment lists the joints the other way round.
    const garment = skinned([bone('spine_01'), bone('pelvis')], [0, 1]);
    expect(bindGarment(garment, body)).toEqual([]);
    const index = garment.geometry.getAttribute('skinIndex');
    expect([index.getX(0), index.getX(1)]).toEqual([1, 0]);
    expect(garment.skeleton).toBe(body.mesh.skeleton);
  });

  it('falls back to the nearest ancestor the body has', () => {
    const body = rig();
    const spine = bone('spine_01');
    const cloth = bone('cloth_flap', spine);
    const garment = skinned([spine, cloth], [1]);
    expect(bindGarment(garment, body)).toEqual(['cloth_flap']);
    expect(garment.geometry.getAttribute('skinIndex').getX(0)).toBe(1);
  });
});

describe('syncGarmentMorphs', () => {
  it('copies the body slider weights by name and zeroes the rest', () => {
    const body = rig();
    body.mesh.morphTargetInfluences![0] = 0.7;
    const garment = skinned([bone('pelvis')], [0], ['body_weight_max', 'garment_only']);
    garment.morphTargetInfluences![1] = 0.4;
    syncGarmentMorphs(garment, body);
    expect(garment.morphTargetInfluences).toEqual([0.7, 0]);
  });
});

describe('body hide', () => {
  it('decodes an LSB-first base64 bitset', () => {
    // 0b00000101, 0b00000010: vertices 0, 2 and 9.
    const flags = decodeHideBitset(btoa(String.fromCharCode(5, 2)), 10);
    expect([...flags]).toEqual([1, 0, 1, 0, 0, 0, 0, 0, 0, 1]);
  });

  it('hides the union of the worn garments and ignores mismatched masks', () => {
    const body = rig();
    applyBodyHide(body.mesh, [
      Uint8Array.from([1, 0, 0]),
      Uint8Array.from([0, 0, 1]),
      Uint8Array.from([1, 1]),
    ]);
    expect([...body.mesh.geometry.getAttribute(BODY_HIDDEN).array]).toEqual([1, 0, 1]);
  });
});

/** A cylinder of skin points (radius 6 cm, normals outward), every vertex fully on one joint. */
function cylinder(bottom: number, top: number, bones: Bone[], joint: number): SkinnedMesh {
  const points: number[] = [];
  const normals: number[] = [];
  for (let y = bottom; y <= top + 1e-9; y += 0.01) {
    for (let i = 0; i < 16; i += 1) {
      const angle = (i / 16) * Math.PI * 2;
      points.push(Math.cos(angle) * 0.06, y, Math.sin(angle) * 0.06);
      normals.push(Math.cos(angle), 0, Math.sin(angle));
    }
  }
  const mesh = skinned(bones, new Array<number>(points.length / 3).fill(joint));
  mesh.geometry.setAttribute('position', new BufferAttribute(Float32Array.from(points), 3));
  mesh.geometry.setAttribute('normal', new BufferAttribute(Float32Array.from(normals), 3));
  return mesh;
}

/** Body (spine skin, top at y = 1) with a head neck above it (neck skin), wired like attachHead. */
function neckRig() {
  const root = new Group();
  const pelvis = bone('pelvis');
  const spine = bone('spine_05', pelvis);
  const clavicle = bone('clavicle_l', spine);
  const neck = bone('neck_01', spine);
  const jaw = bone('FACIAL_C_Jaw', neck);
  root.add(pelvis);
  const body = cylinder(0.7, 1, [pelvis, spine, clavicle, neck], 1);
  root.add(body);
  root.updateMatrixWorld(true);
  const rig = createBodyRig(root, {});
  // The head lists its joints in its own order, with a face bone the body lacks.
  const head = cylinder(1.01, 1.2, [jaw, neck], 1);
  root.add(head);
  root.updateMatrixWorld(true);
  const seam = { head, body: rig.mesh } as unknown as NeckSeamBinding;
  return { rig, seam };
}

function weightsOf(mesh: SkinnedMesh, vertex: number): Map<number, number> {
  const index = mesh.geometry.getAttribute('skinIndex');
  const weight = mesh.geometry.getAttribute('skinWeight');
  const out = new Map<number, number>();
  for (let k = 0; k < 4; k += 1) {
    const w = weight.getComponent(vertex, k);
    if (w > 0)
      out.set(index.getComponent(vertex, k), (out.get(index.getComponent(vertex, k)) ?? 0) + w);
  }
  return out;
}

describe('skinGarmentToHead', () => {
  /** Garment vertices 5 mm off the skin, skinned to the clavicle like the converter's collar. */
  function collar(heights: number[]) {
    const { rig, seam } = neckRig();
    const garment = skinned(
      [bone('clavicle_l')],
      heights.map(() => 0),
    );
    garment.geometry.setAttribute(
      'position',
      new BufferAttribute(Float32Array.from(heights.flatMap((y) => [0.065, y, 0])), 3),
    );
    bindGarment(garment, rig);
    return { garment, seam };
  }

  it('gives a vertex over the head skin the head weights and keeps one over the body', () => {
    const { garment, seam } = collar([1.1, 0.9]);
    expect(skinGarmentToHead(garment, seam)).toBe(1);
    // Head neck joint 1 is the body's neck_01 (garment joint 3).
    expect([...weightsOf(garment, 0)]).toEqual([[3, 1]]);
    // Clavicle is garment joint 2: the vertex over the body is untouched.
    expect([...weightsOf(garment, 1)]).toEqual([[2, 1]]);
  });

  it('blends across the band at the body edge and keeps the weights summing to 1', () => {
    const { garment, seam } = collar([1.0, 1.005, 1.01, 1.02, 1.04]);
    skinGarmentToHead(garment, seam);
    const neckShare = [0, 1, 2, 3, 4].map((v) => weightsOf(garment, v).get(3) ?? 0);
    for (let v = 0; v < 5; v += 1) {
      const total = [...weightsOf(garment, v).values()].reduce((sum, w) => sum + w, 0);
      expect(total).toBeCloseTo(1, 5);
    }
    for (let v = 1; v < 5; v += 1) expect(neckShare[v]!).toBeGreaterThanOrEqual(neckShare[v - 1]!);
    expect(neckShare[0]).toBeLessThan(0.5);
    expect(neckShare[4]).toBeCloseTo(1, 5);
  });

  it('leaves a garment that does not reach the head untouched', () => {
    const { garment, seam } = collar([0.75, 0.8]);
    const before = garment.geometry.getAttribute('skinWeight');
    expect(skinGarmentToHead(garment, seam)).toBe(0);
    expect(garment.geometry.getAttribute('skinWeight')).toBe(before);
  });
});

describe('a garment through a body rebind', () => {
  /** World position of a skinned vertex, morphs and skinning applied. */
  const worldOf = (mesh: SkinnedMesh, vertex: number) =>
    mesh.localToWorld(mesh.getVertexPosition(vertex, new Vector3()));

  it('stays on the body when the sliders rebind it while the turntable is turned', () => {
    const turntable = new Group();
    const root = new Group();
    turntable.add(root);
    const pelvis = bone('pelvis');
    pelvis.position.set(0, 1, 0);
    const spine = bone('spine_01', pelvis);
    spine.position.set(0, 0.3, 0);
    root.add(pelvis);
    const body = skinned([pelvis, spine], [1]);
    body.geometry.getAttribute('position').setXYZ(0, 0.2, 1.4, 0.05);
    root.add(body);
    root.updateMatrixWorld(true);
    body.bind(body.skeleton);
    const rigged = createBodyRig(root, {});

    const garment = skinned([bone('pelvis'), bone('spine_01')], [1]);
    garment.geometry.getAttribute('position').setXYZ(0, 0.2, 1.4, 0.05);
    root.add(garment);
    bindGarment(garment, rigged);
    rigged.garments.push(garment);

    // The viewer turns the character, then a body slider re-bakes the rest pose.
    turntable.rotation.y = Math.PI / 2;
    turntable.updateMatrixWorld(true);
    applyBodySliders(rigged, { height: 0.4 });
    turntable.updateMatrixWorld(true);

    const skin = worldOf(body, 0);
    expect(skin.x).toBeCloseTo(0.05);
    expect(worldOf(garment, 0).distanceTo(skin)).toBeLessThan(1e-6);
  });
});

describe('fitGarmentOverHead', () => {
  /** Garment vertices at (radius, height) on the +X side of the neck, skinned to the clavicle. */
  function garmentAt(points: [number, number][]) {
    const { rig, seam } = neckRig();
    const garment = skinned(
      [bone('clavicle_l')],
      points.map(() => 0),
    );
    garment.geometry.setAttribute(
      'position',
      new BufferAttribute(Float32Array.from(points.flatMap(([r, y]) => [r, y, 0])), 3),
    );
    garment.geometry.morphTargetsRelative = true;
    bindGarment(garment, rig);
    return { garment, seam };
  }
  const radius = (garment: SkinnedMesh, v: number) =>
    Math.hypot(
      garment.geometry.getAttribute('position').getX(v),
      garment.geometry.getAttribute('position').getZ(v),
    );

  it('moves a collar the neck skin stands through out past the skin', () => {
    const { garment, seam } = garmentAt([[0.055, 1.1]]);
    expect(fitGarmentOverHead(garment, seam)).toBe(1);
    expect(radius(garment, 0)).toBeGreaterThanOrEqual(0.06 + 0.0029);
    expect(garment.geometry.getAttribute('position').getY(0)).toBeCloseTo(1.1, 6);
  });

  it('keeps an inner band under the outer one', () => {
    const { garment, seam } = garmentAt([
      [0.055, 1.1],
      [0.058, 1.1],
    ]);
    fitGarmentOverHead(garment, seam);
    expect(radius(garment, 0)).toBeGreaterThanOrEqual(0.0629);
    expect(radius(garment, 1) - radius(garment, 0)).toBeCloseTo(0.003, 4);
  });

  it('leaves a collar clear of the skin and a garment away from the head as they are', () => {
    const { garment, seam } = garmentAt([
      [0.075, 1.1],
      [0.065, 0.8],
    ]);
    const before = Float32Array.from(garment.geometry.getAttribute('position').array);
    expect(fitGarmentOverHead(garment, seam)).toBe(0);
    expect(Float32Array.from(garment.geometry.getAttribute('position').array)).toEqual(before);
  });
});
