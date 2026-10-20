import { describe, expect, it } from 'vitest';

import { REFERENCE_HEIGHT, getCameraPose } from './cameraFocus';

describe('getCameraPose', () => {
  it('returns the authored pose at the reference height', () => {
    expect(getCameraPose('face', REFERENCE_HEIGHT).target[1]).toBeCloseTo(1.72);
  });

  it('scales framing proportionally for shorter characters', () => {
    const tall = getCameraPose('face', REFERENCE_HEIGHT);
    const short = getCameraPose('face', REFERENCE_HEIGHT / 2);
    expect(short.target[1]).toBeCloseTo(tall.target[1] / 2);
    expect(short.position[2]).toBeCloseTo(tall.position[2] / 2);
  });
});
