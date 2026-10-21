import { describe, expect, it } from 'vitest';

import { addFaceClip, type FaceClip } from './faceClips';

const clip: FaceClip = {
  fps: 2,
  duration: 1,
  loop: true,
  names: ['browInnerUp', 'eyeBlinkLeft', 'mouthSmileLeft'],
  frames: [
    [0, 1, 0.2],
    [1, 1, 0.6],
  ],
};

describe('addFaceClip', () => {
  it('interpolates between frames and scales by the weight', () => {
    const out = new Map<string, number>();
    addFaceClip(clip, 0.25, 0.5, out);
    expect(out.get('browInnerUp')).toBeCloseTo(0.25);
    expect(out.get('mouthSmileLeft')).toBeCloseTo(0.2);
  });

  it('never drives the live channels (blinks, gaze)', () => {
    const out = new Map<string, number>();
    addFaceClip(clip, 0, 1, out);
    expect(out.has('eyeBlinkLeft')).toBe(false);
  });

  it('wraps a looped clip, the last frame blending back into the first', () => {
    const out = new Map<string, number>();
    addFaceClip(clip, 0.75, 1, out);
    expect(out.get('browInnerUp')).toBeCloseTo(0.5);
  });

  it('damps mouth channels by the mouth scale and accumulates layers', () => {
    const out = new Map<string, number>([['mouthSmileLeft', 0.1]]);
    addFaceClip(clip, 0, 1, out, 0.5);
    expect(out.get('mouthSmileLeft')).toBeCloseTo(0.2);
  });

  it('holds the last frame of a one-shot clip', () => {
    const out = new Map<string, number>();
    addFaceClip({ ...clip, loop: false }, 10, 1, out);
    expect(out.get('browInnerUp')).toBeCloseTo(1);
  });
});
