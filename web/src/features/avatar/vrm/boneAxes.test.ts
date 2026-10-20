import { Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';

import { axisMapFromRest, scaleToLocal, vectorToLocal } from './boneAxes';

describe('axisMapFromRest', () => {
  it('maps an unrotated bone onto the canonical axes', () => {
    expect(axisMapFromRest(new Matrix4(), false)).toEqual({ axis: [0, 1, 2], sign: [1, 1, 1] });
  });

  it('flips x and z for models facing -Z (VRM 0.x)', () => {
    expect(axisMapFromRest(new Matrix4(), true)).toEqual({ axis: [0, 1, 2], sign: [-1, 1, -1] });
  });

  it('follows a bone rolled 90 degrees so its x axis points up', () => {
    const map = axisMapFromRest(new Matrix4().makeRotationZ(Math.PI / 2), false);
    expect(map.axis).toEqual([1, 0, 2]);
    expect(map.sign).toEqual([1, -1, 1]);
  });
});

describe('scaleToLocal / vectorToLocal', () => {
  const rolled = { axis: [1, 0, 2] as const, sign: [1, -1, 1] as const };

  it('moves a canonical width/height scale onto the matching local axes', () => {
    expect(scaleToLocal([1.1, 1.2, 1.3], rolled)).toEqual([1.2, 1.1, 1.3]);
  });

  it('applies axis signs to vectors', () => {
    expect(vectorToLocal([0.1, 0.2, 0.3], rolled)).toEqual([0.2, -0.1, 0.3]);
  });
});
