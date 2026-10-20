import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { viewerAngles } from './characterLife';

const DEG = Math.PI / 180;
const Y = new Vector3(0, 1, 0);

describe('viewerAngles', () => {
  it('looks straight ahead at a viewer in front of a resting head', () => {
    const aim = viewerAngles(new Quaternion(), new Vector3(0, 0, 2));
    expect(aim.yaw).toBeCloseTo(0);
    expect(aim.pitch).toBeCloseTo(0);
  });

  it('counters a head turned to the left so the eyes stay on the viewer', () => {
    const turned = new Quaternion().setFromAxisAngle(Y, 20 * DEG);
    expect(viewerAngles(turned, new Vector3(0, 0, 2)).yaw).toBeCloseTo(-20 * DEG);
  });

  it('looks up at a viewer above eye level', () => {
    const aim = viewerAngles(new Quaternion(), new Vector3(0, 1, 1));
    expect(aim.pitch).toBeCloseTo(45 * DEG);
    expect(aim.yaw).toBeCloseTo(0);
  });
});
