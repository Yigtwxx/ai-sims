import { describe, expect, it } from 'vitest';

import { LIGHTING_RIGS, convertSpot, ueForward, ueToScene, type Vec3 } from './lighting';

const length = (v: Vec3) => Math.hypot(...v);

describe('Unreal to scene axes', () => {
  it('maps Unreal up (Z) to Y, facing (+Y) to +Z and centimetres to metres', () => {
    expect(ueToScene([0, 0, 170])).toEqual([0, 1.7, 0]);
    expect(ueToScene([0, 250, 0])).toEqual([0, 0, 2.5]);
    expect(ueToScene([-100, 0, 0])).toEqual([-1, 0, 0]);
  });

  it('turns a rotator into a unit forward vector', () => {
    const down = ueForward(-90, 0);
    expect(down[1]).toBeCloseTo(-1);
    const towardCharacter = ueForward(0, -90);
    expect(towardCharacter[2]).toBeCloseTo(-1);
    expect(length(ueForward(-33.4, -54.7))).toBeCloseTo(1);
  });
});

describe('Studio rig', () => {
  const key = LIGHTING_RIGS.studio.spots.find((spot) => spot.name === 'key')!;

  it('places the key high, in front and on the character right', () => {
    expect(key.position[0]).toBeLessThan(0);
    expect(key.position[1]).toBeGreaterThan(2.5);
    expect(key.position[2]).toBeGreaterThan(2);
  });

  it('aims the key at the upper body', () => {
    const chest: Vec3 = [0, 1.4, 0.1];
    const aim: Vec3 = [
      key.target[0] - key.position[0],
      key.target[1] - key.position[1],
      key.target[2] - key.position[2],
    ];
    const toChest: Vec3 = [
      chest[0] - key.position[0],
      chest[1] - key.position[1],
      chest[2] - key.position[2],
    ];
    const cos =
      (aim[0] * toChest[0] + aim[1] * toChest[1] + aim[2] * toChest[2]) /
      (length(aim) * length(toChest));
    // Within the 33° cone.
    expect(Math.acos(cos)).toBeLessThan(key.angle);
  });

  it('keeps candela and turns cone angles into a penumbra', () => {
    const spot = convertSpot({
      name: 's',
      location: [0, 100, 100],
      pitch: 0,
      yaw: -90,
      candela: 10,
      innerCone: 15,
      outerCone: 30,
      attenuationRadius: 400,
      sourceRadius: 0,
      castShadows: false,
      specular: 1,
    });
    expect(spot.intensity).toBe(10);
    expect(spot.penumbra).toBeCloseTo(0.5);
    expect(spot.distance).toBe(4);
  });
});
