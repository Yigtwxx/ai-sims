import { describe, expect, it } from 'vitest';

import { REFERENCE_HEIGHT, closeUpPose, getCameraPose, isCloseUp } from './cameraFocus';

describe('getCameraPose', () => {
  it('returns the authored pose at the reference height', () => {
    expect(getCameraPose('face', REFERENCE_HEIGHT).target[1]).toBeCloseTo(1.68);
  });

  it('scales framing proportionally for shorter characters', () => {
    const tall = getCameraPose('face', REFERENCE_HEIGHT);
    const short = getCameraPose('face', REFERENCE_HEIGHT / 2);
    expect(short.target[1]).toBeCloseTo(tall.target[1] / 2);
    expect(short.position[2]).toBeCloseTo(tall.position[2] / 2);
  });
});

describe('close-ups', () => {
  const eyes = [0.04, 1.6, 0.08] as const;

  it('are only the brows and mouth framings', () => {
    expect(isCloseUp('brows')).toBe(true);
    expect(isCloseUp('mouth')).toBe(true);
    expect(isCloseUp('face')).toBe(false);
    expect(closeUpPose('face', eyes)).toBeNull();
  });

  it('aim relative to the eye centre, from in front of the face', () => {
    const brows = closeUpPose('brows', eyes)!;
    const mouth = closeUpPose('mouth', eyes)!;
    // Centred on the eyes sideways, wherever the pose put the head.
    expect(brows.target[0]).toBeCloseTo(eyes[0]);
    expect(brows.position[0]).toBeCloseTo(eyes[0]);
    // The brows sit just above the eyes, the lower face well below them.
    expect(brows.target[1]).toBeGreaterThan(eyes[1]);
    expect(mouth.target[1]).toBeLessThan(eyes[1] - 0.05);
    expect(brows.position[2]).toBeGreaterThan(eyes[2]);
    // Tighter than the head-and-shoulders framing.
    const distance = (pose: { position: readonly number[]; target: readonly number[] }) =>
      Math.hypot(...pose.position.map((value, i) => value - pose.target[i]!));
    const face = getCameraPose('face');
    expect(distance(brows)).toBeLessThan(distance(face) / 3);
    expect(distance(mouth)).toBeLessThan(distance(face) / 3);
  });

  it('scale their offsets with the character height', () => {
    const tall = closeUpPose('brows', eyes, REFERENCE_HEIGHT)!;
    const short = closeUpPose('brows', eyes, REFERENCE_HEIGHT / 2)!;
    expect(short.position[2] - eyes[2]).toBeCloseTo((tall.position[2] - eyes[2]) / 2);
  });

  it('keep a fixed fallback until the eyes are measured, scaled like the other presets', () => {
    const pose = getCameraPose('brows', REFERENCE_HEIGHT / 2);
    expect(pose.target[1]).toBeCloseTo(getCameraPose('brows').target[1] / 2);
  });

  it('leave the existing presets unchanged', () => {
    expect(getCameraPose('face')).toEqual({ position: [0.05, 1.74, 1.6], target: [0, 1.68, 0.05] });
    expect(getCameraPose('torso')).toEqual({ position: [0, 1.42, 2.6], target: [0, 1.36, 0] });
  });
});

describe('creator framings', () => {
  /** Heights (m) the frame spans at the reference height (vertical FOV 24°, see Stage). */
  const span = (focus: Parameters<typeof getCameraPose>[0]) => {
    const { position, target } = getCameraPose(focus);
    const distance = Math.hypot(...position.map((value, i) => value - target[i]!));
    const half = distance * Math.tan((12 * Math.PI) / 180);
    return { bottom: target[1] - half, top: target[1] + half };
  };

  it('keep tall hair and both shoulders in the head framing', () => {
    expect(span('head').top).toBeGreaterThan(2);
    expect(span('head').bottom).toBeLessThan(1.3);
  });

  it('show a top from mid-thigh to above the head', () => {
    expect(span('upper').top).toBeGreaterThan(1.95);
    expect(span('upper').bottom).toBeLessThan(0.75);
  });

  it('show the bottoms from the feet to the waist', () => {
    expect(span('legs').bottom).toBeLessThan(0);
    expect(span('legs').top).toBeGreaterThan(1.15);
  });
});
