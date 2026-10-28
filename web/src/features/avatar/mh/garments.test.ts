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
  layerGarments,
  releaseBodyHide,
  skinGarmentToHead,
  soleDepth,
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

  it('keeps the mask of the character that dressed after the one torn down', () => {
    // Characters built from one body GLB share its geometry (SkeletonUtils.clone).
    const old = rig();
    const next = new SkinnedMesh(old.mesh.geometry, old.mesh.material);
    applyBodyHide(old.mesh, [Uint8Array.from([1, 1, 0])]);
    applyBodyHide(next, [Uint8Array.from([0, 1, 1])]);
    releaseBodyHide(old.mesh);
    expect([...next.geometry.getAttribute(BODY_HIDDEN).array]).toEqual([0, 1, 1]);
  });

  it('clears the mask a character set itself when it is torn down', () => {
    const body = rig();
    applyBodyHide(body.mesh, [Uint8Array.from([1, 1, 0])]);
    releaseBodyHide(body.mesh);
    expect([...body.mesh.geometry.getAttribute(BODY_HIDDEN).array]).toEqual([0, 0, 0]);
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

  it('clears head skin that pokes out between two garment vertices', () => {
    const { garment, seam } = garmentAt([
      [0.065, 1.09],
      [0.065, 1.11],
    ]);
    // A head vertex between them stands 3 mm out past the cloth; neither garment
    // vertex has it as its nearest head point.
    const head = seam.head.geometry.getAttribute('position');
    const bump = Array.from({ length: head.count }, (_, v) => v).find(
      (v) =>
        Math.abs(head.getY(v) - 1.1) < 1e-6 && Math.abs(head.getZ(v)) < 1e-6 && head.getX(v) > 0,
    )!;
    head.setX(bump, 0.068);
    fitGarmentOverHead(garment, seam);
    for (const v of [0, 1]) expect(radius(garment, v)).toBeGreaterThanOrEqual(0.068 + 0.0055);
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

describe('layerGarments', () => {
  /** Rings of garment vertices at (radius, height) around the body, skinned to the spine. */
  function garmentOf(rig: ReturnType<typeof neckRig>['rig'], rings: [number, number][]) {
    const points = rings.flatMap(([r, y]) =>
      Array.from({ length: 16 }, (_, i) => {
        const angle = (i / 16) * Math.PI * 2;
        return [Math.cos(angle) * r, y, Math.sin(angle) * r];
      }).flat(),
    );
    const garment = skinned([bone('spine_05')], new Array<number>(points.length / 3).fill(0));
    garment.geometry.setAttribute('position', new BufferAttribute(Float32Array.from(points), 3));
    bindGarment(garment, rig);
    return garment;
  }
  const radius = (garment: SkinnedMesh, v: number) =>
    Math.hypot(
      garment.geometry.getAttribute('position').getX(v),
      garment.geometry.getAttribute('position').getZ(v),
    );
  /** A shirt (7.5 cm) and the waistband of trousers that stands out through it (8 cm). */
  function shirtOverWaistband() {
    const { rig } = neckRig();
    const shirt = garmentOf(rig, [
      [0.075, 0.8],
      [0.075, 0.81],
      [0.075, 0.95],
    ]);
    const trousers = garmentOf(rig, [
      [0.08, 0.8],
      [0.08, 0.81],
    ]);
    return { rig, shirt, trousers };
  }

  it('moves the outer garment over the inner one where that comes through it', () => {
    const { rig, shirt, trousers } = shirtOverWaistband();
    expect(layerGarments([shirt], [trousers], rig.mesh)).toBeGreaterThan(0);
    expect(radius(shirt, 0)).toBeGreaterThanOrEqual(0.0839);
    expect(radius(shirt, 16)).toBeGreaterThanOrEqual(0.0839);
    expect(radius(shirt, 32)).toBeCloseTo(0.075, 6);
  });

  it('starts from the unlayered garment every time', () => {
    const { rig, shirt, trousers } = shirtOverWaistband();
    const before = Float32Array.from(shirt.geometry.getAttribute('position').array);
    layerGarments([shirt], [trousers], rig.mesh);
    const once = Float32Array.from(shirt.geometry.getAttribute('position').array);
    layerGarments([shirt], [trousers], rig.mesh);
    expect(Float32Array.from(shirt.geometry.getAttribute('position').array)).toEqual(once);
    expect(layerGarments([shirt], [], rig.mesh)).toBe(0);
    expect(Float32Array.from(shirt.geometry.getAttribute('position').array)).toEqual(before);
  });

  it('moves both faces of an outer hem alike, so the lining stays inside', () => {
    const { rig } = neckRig();
    const hem = garmentOf(rig, [
      [0.075, 0.8],
      [0.078, 0.8],
    ]);
    const trousers = garmentOf(rig, [
      [0.08, 0.8],
      [0.08, 0.81],
    ]);
    layerGarments([hem], [trousers], rig.mesh);
    expect(radius(hem, 0)).toBeGreaterThanOrEqual(0.0839);
    expect(radius(hem, 16) - radius(hem, 0)).toBeCloseTo(0.003, 4);
  });

  it('covers an inner bump that lies between sparse outer vertices', () => {
    const { rig } = neckRig();
    // Shirt rings 4 cm apart; the waistband right under them (its points are
    // every shirt vertex's nearest) and a button tab between the rings.
    const shirt = garmentOf(rig, [
      [0.075, 0.79],
      [0.075, 0.83],
    ]);
    const waistband = garmentOf(
      rig,
      Array.from({ length: 13 }, (_, i) => [0.07, 0.77 + i * 0.005] as [number, number]),
    );
    const button = garmentOf(rig, [[0.085, 0.81]]);
    layerGarments([shirt], [waistband, button], rig.mesh);
    // The straight edge between the rings passes over the tab.
    expect((radius(shirt, 0) + radius(shirt, 16)) / 2).toBeGreaterThan(0.085);
  });

  it('leaves an outer garment alone where the inner one stays under it', () => {
    const { rig } = neckRig();
    const shirt = garmentOf(rig, [[0.09, 0.8]]);
    const trousers = garmentOf(rig, [[0.07, 0.8]]);
    expect(layerGarments([shirt], [trousers], rig.mesh)).toBe(0);
    expect(radius(shirt, 0)).toBeCloseTo(0.09, 6);
  });
});

describe('soleDepth', () => {
  /** A garment geometry with vertices at these heights (bind space, floor at y = 0). */
  const heights = (ys: number[]) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new BufferAttribute(Float32Array.from(ys.flatMap((y, i) => [i * 0.001, y, 0])), 3),
    );
    return geometry;
  };
  /** A flat sole: `count` vertices spread over the millimetre above `bottom`. */
  const sole = (bottom: number, count = 40) =>
    Array.from({ length: count }, (_, i) => bottom + (i / count) * 0.001);

  it('is the depth of a flat sole under the floor', () => {
    expect(soleDepth(heights([...sole(-0.0246), 0.03, 0.05]))).toBeCloseTo(0.0246, 6);
  });

  it('is zero for a garment that stays above the floor', () => {
    expect(soleDepth(heights([0.08, 0.5, 1.1]))).toBe(0);
  });

  it('skips a few stray vertices below the sole', () => {
    // The female Oxfords: 8 vertices hang 1.6 cm under a sole at -2.53 cm.
    const strays = [-0.0409, -0.0409, -0.0403, -0.0403, -0.036, -0.036, -0.0354, -0.0354];
    expect(soleDepth(heights([...strays, ...sole(-0.0253)]))).toBeCloseTo(0.0253, 6);
  });

  it('ignores a handful of vertices just under the floor', () => {
    // The streetwear bomber jacket: five degenerate vertices at the origin.
    expect(soleDepth(heights([-0.0006, -0.0006, -0.0006, -0.0006, -0.0006, 0.82, 1.4]))).toBe(0);
  });
});
