import { describe, expect, it } from 'vitest';

import { idleOffsets, mirrorForVersion, RELAXED_POSE } from './pose';

describe('RELAXED_POSE', () => {
  it('lowers both arms and mirrors them across the body', () => {
    const [, , leftZ] = RELAXED_POSE.leftUpperArm!;
    const [, , rightZ] = RELAXED_POSE.rightUpperArm!;
    expect(leftZ).toBeLessThan(-1);
    expect(rightZ).toBeGreaterThan(1);
  });

  it('curls every finger joint towards the palm on both hands', () => {
    for (const finger of ['Index', 'Middle', 'Ring', 'Little']) {
      for (const joint of ['Proximal', 'Intermediate', 'Distal']) {
        const left = RELAXED_POSE[`left${finger}${joint}` as keyof typeof RELAXED_POSE]!;
        const right = RELAXED_POSE[`right${finger}${joint}` as keyof typeof RELAXED_POSE]!;
        expect(left[2]).toBeLessThan(0);
        expect(right[2]).toBeCloseTo(-left[2]);
      }
    }
  });

  it('bends the relaxed knee of the free leg', () => {
    expect(RELAXED_POSE.leftLowerLeg![0]).toBeGreaterThan(0);
  });
});

describe('mirrorForVersion', () => {
  it('flips X and Z for VRM 0.x and keeps Y', () => {
    expect(mirrorForVersion([0.1, 0.2, 0.3], true)).toEqual([-0.1, 0.2, -0.3]);
    expect(mirrorForVersion([0.1, 0.2, 0.3], false)).toEqual([0.1, 0.2, 0.3]);
  });
});

describe('idleOffsets', () => {
  it('stays subtle so the pose never visibly drifts', () => {
    for (const t of [0, 1.3, 7.7, 42]) {
      for (const euler of Object.values(idleOffsets(t))) {
        for (const value of euler!) expect(Math.abs(value)).toBeLessThan(0.05);
      }
    }
  });
});
