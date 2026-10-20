import { Bone, Group, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { applyBodyShape, clampHeight, HEIGHT_RANGE } from './bodyShape';

/** Minimal humanoid chain: root > hips > spine > chest > neck > head, chest > leftShoulder. */
function makeSkeleton() {
  const root = new Group();
  const bones: Record<string, Bone> = {};
  const add = (name: string, parent: Bone | Group) => {
    const bone = new Bone();
    bone.name = name;
    parent.add(bone);
    bones[name] = bone;
    return bone;
  };
  const hips = add('hips', root);
  const spine = add('spine', hips);
  const chest = add('chest', spine);
  add('head', add('neck', chest));
  add('leftShoulder', chest);
  return { root, bones, lookup: (name: string) => bones[name] };
}

const ALL = ['hips', 'spine', 'chest', 'neck', 'head', 'leftShoulder'];

function worldScale(bone: Bone) {
  bone.updateWorldMatrix(true, false);
  return bone.getWorldScale(new Vector3());
}

describe('applyBodyShape', () => {
  it('leaves the skeleton untouched for the average build', () => {
    const { bones, lookup } = makeSkeleton();
    applyBodyShape(lookup, ALL, { build: 'average', height: 1 });
    expect(bones.chest.scale.toArray()).toEqual([1, 1, 1]);
  });

  it('widens the chest for an athletic build', () => {
    const { bones, lookup } = makeSkeleton();
    applyBodyShape(lookup, ALL, { build: 'athletic', height: 1 });
    expect(bones.chest.scale.x).toBeGreaterThan(1);
  });

  it('keeps protected bones at their authored world size', () => {
    const { bones, lookup } = makeSkeleton();
    applyBodyShape(lookup, ALL, { build: 'athletic', height: 1 });
    const head = worldScale(bones.head);
    expect(head.x).toBeCloseTo(1);
    expect(head.z).toBeCloseTo(1);
    expect(worldScale(bones.leftShoulder).x).toBeCloseTo(1);
  });

  it('respects a uniform root scale when protecting bones', () => {
    const { root, bones, lookup } = makeSkeleton();
    root.scale.setScalar(1.05);
    applyBodyShape(lookup, ALL, { build: 'slim', height: 1.05 });
    expect(worldScale(bones.head).x).toBeCloseTo(1.05);
  });

  it('maps profile axes onto rotated bones (VRM 1.0 rest orientation)', () => {
    const { bones, lookup } = makeSkeleton();
    // The chest's local x points up the spine, so the canonical width goes to local y.
    const rolled = { axis: [1, 0, 2] as const, sign: [1, 1, 1] as const };
    applyBodyShape(
      lookup,
      ALL,
      { build: 'athletic', height: 1 },
      {
        axes: (bone) => (bone === bones.chest ? rolled : { axis: [0, 1, 2], sign: [1, 1, 1] }),
      },
    );
    expect(bones.chest.scale.x).toBeCloseTo(1);
    expect(bones.chest.scale.y).toBeGreaterThan(1);
  });

  it('applies a fit to its own bone only', () => {
    const { bones, lookup } = makeSkeleton();
    applyBodyShape(
      lookup,
      ALL,
      { build: 'average', height: 1 },
      { fit: (name) => (name === 'chest' ? [1.2, 1, 1] : undefined) },
    );
    expect(worldScale(bones.chest).x).toBeCloseTo(1.2);
    expect(worldScale(bones.neck).x).toBeCloseTo(1);
    expect(worldScale(bones.head).x).toBeCloseTo(1);
  });

  it('is idempotent across repeated calls', () => {
    const { bones, lookup } = makeSkeleton();
    applyBodyShape(lookup, ALL, { build: 'curvy', height: 1 });
    const first = bones.hips.scale.clone();
    applyBodyShape(lookup, ALL, { build: 'curvy', height: 1 });
    expect(bones.hips.scale.equals(first)).toBe(true);
  });
});

describe('clampHeight', () => {
  it('clamps to the supported range', () => {
    expect(clampHeight(2)).toBe(HEIGHT_RANGE.max);
    expect(clampHeight(0.5)).toBe(HEIGHT_RANGE.min);
    expect(clampHeight(1)).toBe(1);
  });
});
