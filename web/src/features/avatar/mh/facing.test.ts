import { Euler, Group, Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { FACING_SLACK, chestYaw, counterTurn, keepFacing } from './facing';

const DEG = Math.PI / 180;

/** Clavicles of a chest turned `yaw` about +Y (left on +X at rest). */
const clavicles = (yaw: number) => {
  const left = new Vector3(0.18, 1.45, 0).applyAxisAngle(new Vector3(0, 1, 0), yaw);
  const right = new Vector3(-0.18, 1.45, 0).applyAxisAngle(new Vector3(0, 1, 0), yaw);
  return { left, right };
};

describe('chestYaw', () => {
  it('reads the turn of the chest, + toward the character left', () => {
    const { left, right } = clavicles(40 * DEG);
    expect(chestYaw(left, right)).toBeCloseTo(40 * DEG);
    const back = clavicles(-25 * DEG);
    expect(chestYaw(back.left, back.right)).toBeCloseTo(-25 * DEG);
  });
});

describe('counterTurn', () => {
  it('leaves a small sway alone', () => {
    expect(counterTurn(FACING_SLACK * 0.9)).toBe(0);
    expect(counterTurn(-FACING_SLACK * 0.5)).toBe(0);
  });

  it('turns back only the part beyond the slack', () => {
    expect(counterTurn(40 * DEG)).toBeCloseTo(-(40 * DEG - FACING_SLACK));
    expect(counterTurn(-30 * DEG)).toBeCloseTo(30 * DEG - FACING_SLACK);
  });
});

describe('keepFacing', () => {
  /** A scene root holding a root bone with both clavicles under it, the chest turned `yaw`. */
  const rig = (yaw: number) => {
    const scene = new Group();
    const rootBone = new Object3D();
    const left = new Object3D();
    const right = new Object3D();
    scene.add(rootBone);
    rootBone.add(left, right);
    const turned = clavicles(yaw);
    left.position.copy(turned.left);
    right.position.copy(turned.right);
    return { scene, rootBone, left, right };
  };
  const yawOf = (object: Object3D) => new Euler().setFromQuaternion(object.quaternion, 'YXZ').y;

  it('turns the root bone against a held body turn and settles there', () => {
    const { scene, rootBone, left, right } = rig(50 * DEG);
    for (let i = 0; i < 600; i++) keepFacing(rootBone, left, right, 1 / 60);
    // The turn already written is taken off before measuring: it does not feed back.
    expect(yawOf(rootBone)).toBeCloseTo(-(50 * DEG - FACING_SLACK), 3);
    // The scene root stays put (skinned meshes bake it into their bind matrix).
    expect(scene.rotation.y).toBe(0);
  });

  it('starts from whatever the clip wrote this frame', () => {
    const { rootBone, left, right } = rig(50 * DEG);
    for (let i = 0; i < 600; i++) keepFacing(rootBone, left, right, 1 / 60);
    // A clip track overwrites the bone: the turn is applied on top of the new pose.
    rootBone.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 10 * DEG);
    keepFacing(rootBone, left, right, 1 / 60);
    expect(yawOf(rootBone)).toBeCloseTo(10 * DEG - (50 * DEG - FACING_SLACK), 2);
  });

  it('leaves a facing character alone and does nothing without clavicles', () => {
    const { rootBone, left, right } = rig(3 * DEG);
    for (let i = 0; i < 60; i++) keepFacing(rootBone, left, right, 1 / 60);
    expect(yawOf(rootBone)).toBeCloseTo(0);
    keepFacing(rootBone, undefined, undefined, 1 / 60);
    expect(yawOf(rootBone)).toBeCloseTo(0);
  });
});
