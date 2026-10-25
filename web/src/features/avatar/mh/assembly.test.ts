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

import {
  alignLoops,
  bindNeckSeam,
  bodySliderKey,
  createBodyRig,
  type NeckSeamExtras,
} from './assembly';

const RING = 8;

function ring(radius: number, height: number, start = 0, direction = 1): Vector3[] {
  return Array.from({ length: RING }, (_, i) => {
    const angle = ((start + direction * i) / RING) * Math.PI * 2;
    return new Vector3(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
  });
}

/**
 * A skinned strip: a boundary ring plus one inner ring, every vertex on the
 * same bones with the same weights (one bone unless given more), bound to them
 * where they are now.
 */
function skinnedStrip(
  name: string,
  rings: Vector3[][],
  bones: Bone | Bone[],
  weights: number[] = [1, 0, 0, 0],
): SkinnedMesh {
  const points = rings.flat();
  const skeleton = new Skeleton(Array.isArray(bones) ? bones : [bones]);
  const second = skeleton.bones.length > 1 ? 1 : 0;
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(Float32Array.from(points.flatMap((p) => p.toArray())), 3),
  );
  geometry.setAttribute(
    'normal',
    new BufferAttribute(Float32Array.from(points.flatMap(() => [0, 1, 0])), 3),
  );
  geometry.setAttribute(
    '_dna_position',
    new BufferAttribute(Float32Array.from(points.map((_, i) => i)), 1),
  );
  geometry.setAttribute(
    'skinIndex',
    new BufferAttribute(Uint16Array.from(points.flatMap(() => [0, second, 0, 0])), 4),
  );
  geometry.setAttribute(
    'skinWeight',
    new BufferAttribute(Float32Array.from(points.flatMap(() => weights)), 4),
  );
  const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial({ name }));
  mesh.bind(skeleton);
  return mesh;
}

function seam(primitive: string): NeckSeamExtras {
  const boundary = Array.from({ length: RING }, (_, i) => i);
  return {
    primitive,
    boundary,
    vertices: Array.from({ length: RING * 2 }, (_, i) => i),
    weights: Array.from({ length: RING * 2 }, (_, i) => (i < RING ? 1 : 0.5)),
  };
}

function worldOf(mesh: SkinnedMesh, vertex: number): Vector3 {
  return mesh.getVertexPosition(vertex, new Vector3()).applyMatrix4(mesh.matrixWorld);
}

describe('alignLoops', () => {
  it('finds the shift and direction between two walks of the same loop', () => {
    const a = ring(1, 0);
    expect(alignLoops(a, ring(1, 0, 3))).toEqual({ shift: 5, direction: 1 });
    expect(alignLoops(a, ring(1, 0, 2, -1))).toEqual({ shift: 2, direction: -1 });
  });
});

describe('bindNeckSeam', () => {
  it('welds the head boundary to the body boundary and fades the offset over the rings', () => {
    const root = new Group();
    const bone = new Bone();
    bone.name = 'neck_01';
    root.add(bone);
    // Body neck: radius 0.06; the head was sculpted for a 0.05 neck, walked the other way.
    const body = skinnedStrip('body', [ring(0.06, 1.4), ring(0.06, 1.3)], bone);
    const head = skinnedStrip('head', [ring(0.05, 1.4, 3, -1), ring(0.05, 1.5, 3, -1)], bone);
    root.add(body, head);
    root.updateMatrixWorld(true);

    const rig = createBodyRig(root, {});
    const binding = bindNeckSeam([head], seam('head'), rig, seam('body'));

    expect(binding).toBeDefined();
    for (let i = 0; i < RING; i += 1) {
      // Welded, then tucked 0.3 mm past the seam (away from the head) and
      // 0.05 mm under the body skin, which here both point down the strip.
      const welded = worldOf(body, binding!.bodyVertex[i]!);
      const skirt = worldOf(head, i).sub(welded);
      expect(skirt.y).toBeCloseTo(-0.00035, 6);
      expect(Math.hypot(skirt.x, skirt.z)).toBeLessThan(1e-6);
    }
    // An inner ring vertex (falloff 0.5) moves about half of the 1 cm outward offset of
    // its two nearest boundary vertices, and only outwards.
    const inner = worldOf(head, RING);
    const radius = Math.hypot(inner.x, inner.z);
    expect(radius).toBeGreaterThan(0.0535);
    expect(radius).toBeLessThan(0.0551);
    expect(inner.y).toBeCloseTo(1.5, 6);
  });

  it('keeps the boundary on the body edge as the bones move, though the head was bound elsewhere', () => {
    const root = new Group();
    const spine = new Bone();
    spine.name = 'spine_05';
    const neck = new Bone();
    neck.name = 'neck_01';
    root.add(spine, neck);
    const halves = [0.5, 0.5, 0, 0];
    // A preset head binds its joints where its own body had them: here the
    // spine joint 3 cm to the side of where this body binds it.
    spine.position.set(0.03, 0, 0);
    root.updateMatrixWorld(true);
    const head = skinnedStrip(
      'head',
      [ring(0.05, 1.4, 3, -1), ring(0.05, 1.5, 3, -1)],
      [spine, neck],
      halves,
    );
    spine.position.set(0, 0, 0);
    root.updateMatrixWorld(true);
    const body = skinnedStrip('body', [ring(0.06, 1.4), ring(0.06, 1.3)], [spine, neck], halves);
    root.add(body, head);
    root.updateMatrixWorld(true);

    const rig = createBodyRig(root, {});
    const binding = bindNeckSeam([head], seam('head'), rig, seam('body'));
    expect(binding).toBeDefined();
    const gap = (i: number) => worldOf(head, i).distanceTo(worldOf(body, binding!.bodyVertex[i]!));
    const atRest = Array.from({ length: RING }, (_, i) => gap(i));

    spine.rotation.set(0, 0, 0.3);
    root.updateMatrixWorld(true);
    for (let i = 0; i < RING; i += 1) {
      // Only the skirt between them; with the head's own inverse binds the
      // edge slid about 2 mm off the body's.
      expect(Math.abs(gap(i) - atRest[i]!)).toBeLessThan(1e-5);
      expect(gap(i)).toBeLessThan(0.0004);
    }
  });

  it('returns undefined when either side has no seam data', () => {
    const root = new Group();
    const bone = new Bone();
    root.add(bone);
    const body = skinnedStrip('body', [ring(0.06, 1.4)], bone);
    const head = skinnedStrip('head', [ring(0.05, 1.4)], bone);
    root.add(body, head);
    root.updateMatrixWorld(true);
    const rig = createBodyRig(root, {});
    expect(bindNeckSeam([head], undefined, rig, seam('body'))).toBeUndefined();
    expect(bindNeckSeam([head], seam('head'), rig, undefined)).toBeUndefined();
  });
});

describe('bodySliderKey', () => {
  it('is the same for equal values in a fresh object (the creator clones the config per edit)', () => {
    const sliders = { height: 0.2, waist: -0.5 };
    expect(bodySliderKey(structuredClone(sliders))).toBe(bodySliderKey(sliders));
  });

  it('treats a missing slider as neutral', () => {
    expect(bodySliderKey({ height: 0.2, weight: 0 })).toBe(bodySliderKey({ height: 0.2 }));
    expect(bodySliderKey({})).toBe(bodySliderKey(undefined));
  });

  it('changes when any slider moves', () => {
    const before = bodySliderKey({ height: 0.2 });
    expect(bodySliderKey({ height: 0.21 })).not.toBe(before);
    expect(bodySliderKey({ height: 0.2, shoulders: 0.1 })).not.toBe(before);
  });
});
