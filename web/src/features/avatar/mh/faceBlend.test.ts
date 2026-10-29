import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  Group,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Matrix4,
  MeshStandardMaterial,
  Skeleton,
  SkinnedMesh,
} from 'three';
import { describe, expect, it } from 'vitest';

import {
  applyFaceBlend,
  blendable,
  blendAttribute,
  blendGeometry,
  blendWeights,
  prepareFaceBlend,
  prepareFaceBlendNow,
  type FaceBlendSource,
} from './faceBlend';

/** A two-vertex primitive with one morph target and the converter's DNA indices. */
function geometry(offset: number, morph: number, dna = [0, 1]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([offset, 0, 0, offset, 1, 0]), 3),
  );
  g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 1]), 2));
  g.setAttribute('_dna_position', new BufferAttribute(new Float32Array(dna), 1));
  g.morphAttributes.position = [
    new BufferAttribute(new Int16Array([morph, 0, 0, morph, 0, 0]), 3, true),
  ];
  g.morphTargetsRelative = true;
  return g;
}

/**
 * A head GLB scene: a facial root under `head` with one eye, the eye's
 * inverse bind at its rest, and one primitive per material name.
 */
function headScene(offset: number, morph: number, eyeZ: number, names = ['head', 'teeth']) {
  const root = new Group();
  const head = new Bone();
  head.name = 'head';
  const eye = new Bone();
  eye.name = 'FACIAL_L_Eye';
  eye.position.set(0, 0, eyeZ);
  head.add(eye);
  root.add(head);
  const inverses = [new Matrix4(), new Matrix4().makeTranslation(0, 0, -eyeZ)];
  const skeleton = new Skeleton([head, eye], inverses);
  const meshes = names.map((name) => {
    const mesh = new SkinnedMesh(geometry(offset, morph), new MeshStandardMaterial({ name }));
    // With a bind matrix, bind() keeps the inverses instead of recomputing them.
    mesh.bind(skeleton, new Matrix4());
    root.add(mesh);
    return mesh;
  });
  return { root, meshes, eye, head, skeleton };
}

describe('blendWeights', () => {
  it('keeps weights that sum to at most one', () => {
    expect(blendWeights([0.3, 0.4])).toEqual([0.3, 0.4]);
  });

  it('scales weights past a total of one down to sum to one', () => {
    const [a, b] = blendWeights([0.9, 0.6]);
    expect(a! + b!).toBeCloseTo(1);
    expect(a! / b!).toBeCloseTo(1.5);
  });

  it('clamps out-of-range weights', () => {
    expect(blendWeights([-0.2, 0.5])).toEqual([0, 0.5]);
  });
});

describe('blendAttribute', () => {
  it('moves each component towards the sources by their weights', () => {
    const base = new BufferAttribute(new Float32Array([0, 0, 0]), 3);
    const a = new BufferAttribute(new Float32Array([1, 2, 3]), 3);
    const b = new BufferAttribute(new Float32Array([-1, 0, 0]), 3);
    expect([...blendAttribute(base, [a], [0.5]).array]).toEqual([0.5, 1, 1.5]);
    expect([...blendAttribute(base, [a, b], [0.5, 0.5]).array]).toEqual([0, 1, 1.5]);
  });

  it('rounds quantized components in their own type', () => {
    const base = new BufferAttribute(new Int16Array([100, 32000]), 1, true);
    const source = new BufferAttribute(new Int16Array([101, 32767]), 1, true);
    const out = blendAttribute(base, [source], [0.5]);
    expect(out.array).toBeInstanceOf(Int16Array);
    expect(out.normalized).toBe(true);
    expect([...out.array]).toEqual([101, 32384]);
  });

  it('blends mixed component types in value units', () => {
    // The converter writes some targets as float and others as normalized int16.
    const base = new BufferAttribute(new Float32Array([0.5, 0]), 1);
    const source = new BufferAttribute(new Int16Array([0, 32767]), 1, true);
    const out = blendAttribute(base, [source], [0.5]);
    expect(out.normalized).toBe(false);
    expect(out.getX(0)).toBeCloseTo(0.25);
    expect(out.getX(1)).toBeCloseTo(0.5);
  });

  it('returns the base itself when every input is zero', () => {
    const base = new BufferAttribute(new Int16Array(6), 3, true);
    const source = new BufferAttribute(new Float32Array(6), 3);
    expect(blendAttribute(base, [source], [0.5])).toBe(base);
  });

  it('reads interleaved sources', () => {
    const base = new BufferAttribute(new Int16Array([0, 0, 0, 0, 0, 0]), 3, true);
    // stride 4: x y z pad per vertex, as meshopt lays out int16 vectors
    const data = new InterleavedBuffer(new Int16Array([10, 20, 30, 0, 40, 50, 60, 0]), 4);
    const source = new InterleavedBufferAttribute(data, 3, 0, true);
    expect([...blendAttribute(base, [source], [1]).array]).toEqual([10, 20, 30, 40, 50, 60]);
  });
});

describe('blendGeometry', () => {
  it('owns the blended attributes and shares the rest with the base', () => {
    const base = geometry(0, 0);
    const out = blendGeometry(base, [geometry(1, 1000)], [0.25]);
    expect(out.getAttribute('position').getX(0)).toBeCloseTo(0.25);
    expect(out.morphAttributes.position![0]!.array[0]).toBe(250);
    expect(out.getAttribute('uv')).toBe(base.getAttribute('uv'));
    expect(out.morphTargetsRelative).toBe(true);
    // The loader's geometry is untouched.
    expect(base.getAttribute('position').getX(0)).toBe(0);
  });

  it('keeps blended normals unit length', () => {
    const base = geometry(0, 0);
    const tilted = geometry(0, 0);
    tilted.setAttribute('normal', new BufferAttribute(new Float32Array([1, 0, 0, 1, 0, 0]), 3));
    const n = blendGeometry(base, [tilted], [0.5]).getAttribute('normal');
    expect(Math.hypot(n.getX(0), n.getY(0), n.getZ(0))).toBeCloseTo(1);
    expect(n.getX(0)).toBeCloseTo(Math.SQRT1_2);
  });
});

describe('blendable', () => {
  it('accepts heads of one topology', () => {
    expect(blendable(geometry(0, 0), geometry(1, 5))).toBe(true);
  });

  it('refuses a different vertex order', () => {
    expect(blendable(geometry(0, 0), geometry(0, 0, [1, 0]))).toBe(false);
  });

  it('accepts a morph target stored in another component type', () => {
    const other = geometry(0, 0);
    other.morphAttributes.position = [new BufferAttribute(new Float32Array(6), 3)];
    expect(blendable(geometry(0, 0), other)).toBe(true);
  });

  it('refuses a different morph count', () => {
    const other = geometry(0, 0);
    other.morphAttributes.position = [];
    expect(blendable(geometry(0, 0), other)).toBe(false);
  });
});

describe('prepareFaceBlend + applyFaceBlend', () => {
  /** Blends `worn` towards `sources` the way MhCharacter does, on the scene itself. */
  function blend(worn: ReturnType<typeof headScene>, sources: FaceBlendSource[]) {
    const prepared = prepareFaceBlendNow(worn.root, sources);
    if (prepared) applyFaceBlend(worn.meshes, new Set([worn.eye]), prepared);
    return prepared;
  }

  it('blends every primitive, the face-only joints and their inverse binds', () => {
    const worn = headScene(0, 0, 0.09);
    const towards = headScene(1, 1000, 0.1);
    expect(blend(worn, [{ root: towards.root, weight: 0.5 }])).not.toBeNull();
    for (const mesh of worn.meshes) {
      expect(mesh.geometry.getAttribute('position').getX(0)).toBeCloseTo(0.5);
      expect(mesh.geometry.morphAttributes.position![0]!.array[0]).toBe(500);
    }
    expect(worn.eye.position.z).toBeCloseTo(0.095);
    // The eye's inverse bind moves with it, so the eyeball still sits on its joint at rest.
    expect(worn.skeleton.boneInverses[1]!.elements[14]).toBeCloseTo(-0.095);
  });

  it('never moves a bone it was not given (the shared body bones)', () => {
    const worn = headScene(0, 0, 0.09);
    const towards = headScene(1, 0, 0.1);
    towards.head.position.set(0, 0.5, 0);
    blend(worn, [{ root: towards.root, weight: 1 }]);
    expect(worn.head.position.y).toBe(0);
  });

  it('does nothing without a positive weight', () => {
    const worn = headScene(0, 0, 0.09);
    const before = worn.meshes[0]!.geometry;
    const towards = headScene(1, 0, 0.1);
    expect(blend(worn, [{ root: towards.root, weight: 0 }])).toBeNull();
    expect(worn.meshes[0]!.geometry).toBe(before);
  });

  it('leaves a primitive the source lacks as it is', () => {
    const worn = headScene(0, 0, 0.09);
    const towards = headScene(1, 0, 0.1, ['head']);
    const teeth = worn.meshes[1]!.geometry;
    blend(worn, [{ root: towards.root, weight: 1 }]);
    expect(worn.meshes[0]!.geometry.getAttribute('position').getX(0)).toBeCloseTo(1);
    expect(worn.meshes[1]!.geometry).toBe(teeth);
  });

  it('works the same a few milliseconds at a time', async () => {
    const worn = headScene(0, 0, 0.09);
    const towards = headScene(1, 1000, 0.1);
    const prepared = await prepareFaceBlend(worn.root, [{ root: towards.root, weight: 0.5 }], 0);
    expect(prepared?.geometries.get('head')?.getAttribute('position').getX(0)).toBeCloseTo(0.5);
  });

  it('keeps the heads’ bounds instead of recomputing them', () => {
    const worn = headScene(0, 0, 0.09);
    worn.meshes[0]!.geometry.computeBoundingSphere();
    const towards = headScene(1, 0, 0.1);
    towards.meshes[0]!.geometry.computeBoundingSphere();
    const sphere = prepareFaceBlendNow(worn.root, [
      { root: towards.root, weight: 0.5 },
    ])?.geometries.get('head')?.boundingSphere;
    expect(sphere?.containsPoint(worn.meshes[0]!.geometry.boundingSphere!.center)).toBe(true);
    expect(sphere?.containsPoint(towards.meshes[0]!.geometry.boundingSphere!.center)).toBe(true);
  });
});
