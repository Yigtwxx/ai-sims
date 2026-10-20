import { Bone, Group, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import {
  ARM_RELAX,
  breath,
  createGaze,
  eyeLookMorphs,
  idlePose,
  stepGaze,
  type BoneRotation,
} from './idle';
import { applyPose, createPoseRig } from './pose';

const angleOf = (rotations: BoneRotation[], bone: string, axis: 0 | 1 | 2) =>
  rotations
    .filter((r) => r.bone === bone && r.axis[axis] === 1)
    .reduce((sum, r) => sum + r.angle, 0);

/** Deterministic random source cycling through fixed values. */
const sequence = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

describe('idlePose', () => {
  it('relaxes both arms out of the bind A-pose, mirrored', () => {
    const pose = idlePose({ t: 0, mode: 'idle' });
    expect(angleOf(pose, 'upperarm_l', 2)).toBeCloseTo(-ARM_RELAX, 1);
    expect(angleOf(pose, 'upperarm_r', 2)).toBeCloseTo(ARM_RELAX, 1);
  });

  it('keeps every layer subtle apart from the arm relax', () => {
    for (let t = 0; t < 30; t += 0.37) {
      for (const mode of ['idle', 'listening', 'speaking', 'thinking'] as const) {
        for (const r of idlePose({ t, mode, loudness: 1 })) {
          const limit = r.bone.startsWith('upperarm') && r.axis[2] === 1 ? 0.6 : 0.2;
          expect(Math.abs(r.angle)).toBeLessThan(limit);
        }
      }
    }
  });

  it('is a pure function of its input', () => {
    expect(idlePose({ t: 4.2, mode: 'speaking', loudness: 0.5 })).toEqual(
      idlePose({ t: 4.2, mode: 'speaking', loudness: 0.5 }),
    );
  });

  it('nods the head down with speech loudness', () => {
    const quiet = angleOf(idlePose({ t: 3, mode: 'speaking', loudness: 0 }), 'head', 0);
    const loud = angleOf(idlePose({ t: 3, mode: 'speaking', loudness: 1 }), 'head', 0);
    expect(loud).toBeGreaterThan(quiet);
  });
});

describe('breath', () => {
  it('stays within 0..1 over a cycle', () => {
    for (let t = 0; t < 8.4; t += 0.05) {
      expect(breath(t)).toBeGreaterThanOrEqual(-1e-9);
      expect(breath(t)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe('stepGaze', () => {
  it('holds a fixation until the next saccade is due', () => {
    const start = { ...createGaze(), nextIn: 1 };
    const held = stepGaze(start, 0.5, 'idle', sequence(0.9));
    expect(held.targetYaw).toBe(0);
    expect(held.nextIn).toBeCloseTo(0.5);
  });

  it('jumps to a new target quickly once due', () => {
    let gaze = { ...createGaze(), nextIn: 0 };
    gaze = stepGaze(gaze, 1 / 60, 'idle', sequence(1, 1, 0.5));
    expect(gaze.targetYaw).toBeGreaterThan(0);
    for (let i = 0; i < 12; i += 1) gaze = stepGaze(gaze, 1 / 60, 'idle', sequence(0.5));
    expect(gaze.yaw).toBeCloseTo(gaze.targetYaw, 3);
  });

  it('looks up and away while thinking', () => {
    const gaze = stepGaze({ ...createGaze(), nextIn: 0 }, 1 / 60, 'thinking', sequence(0.2));
    expect(gaze.targetPitch).toBeGreaterThan(0.1);
    expect(Math.abs(gaze.targetYaw)).toBeGreaterThan(0.15);
  });
});

describe('eyeLookMorphs', () => {
  it('turns both eyes to the character left as out-left and in-right', () => {
    const m = eyeLookMorphs(0.2, 0);
    expect(m.eyeLookOutLeft).toBeGreaterThan(0);
    expect(m.eyeLookInRight).toBeGreaterThan(0);
    expect(m.eyeLookInLeft).toBe(0);
    expect(m.eyeLookOutRight).toBe(0);
  });

  it('clamps to 1 and lowers the lids when looking down', () => {
    const m = eyeLookMorphs(0, -2);
    expect(m.eyeLookDownLeft).toBe(1);
    expect(m.eyeLookUpLeft).toBe(0);
  });
});

describe('applyPose', () => {
  it('rotates about character-space axes whatever the parent orientation', () => {
    const root = new Group();
    const parent = new Bone();
    parent.name = 'parent';
    parent.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    const child = new Bone();
    child.name = 'child';
    const tip = new Bone();
    tip.position.set(1, 0, 0);
    root.add(parent);
    parent.add(child);
    child.add(tip);
    const rig = createPoseRig(root, ['child']);

    // The parent is turned 90° about Y, so the child's local axes differ from the
    // character's; the tip must still swing exactly 90° about character Z.
    root.updateMatrixWorld(true);
    const before = tip.getWorldPosition(new Vector3());
    applyPose(rig, [{ bone: 'child', axis: [0, 0, 1], angle: Math.PI / 2 }]);
    root.updateMatrixWorld(true);
    const after = tip.getWorldPosition(new Vector3());
    const expected = before
      .clone()
      .applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2));
    expect(after.distanceTo(expected)).toBeLessThan(1e-6);
  });

  it('starts from rest every frame so layers never accumulate', () => {
    const root = new Group();
    const bone = new Bone();
    bone.name = 'b';
    root.add(bone);
    const rig = createPoseRig(root, ['b']);
    const rotation = [{ bone: 'b', axis: [1, 0, 0] as const, angle: 0.3 }];
    applyPose(rig, rotation);
    const once = bone.quaternion.clone();
    applyPose(rig, rotation);
    expect(bone.quaternion.angleTo(once)).toBeLessThan(1e-6);
  });
});
