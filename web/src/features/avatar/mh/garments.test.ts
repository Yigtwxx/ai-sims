import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  Group,
  MeshStandardMaterial,
  Skeleton,
  SkinnedMesh,
} from 'three';
import { describe, expect, it } from 'vitest';

import { createBodyRig } from './assembly';
import {
  applyBodyHide,
  BODY_HIDDEN,
  bindGarment,
  decodeHideBitset,
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
