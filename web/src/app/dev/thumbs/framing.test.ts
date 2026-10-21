import { describe, expect, it } from 'vitest';

import type { ThumbShot } from '@/components/dev/thumbConfig';

import {
  cameraFor,
  headHeight,
  poseDistance,
  shotBox,
  squareFov,
  type Landmarks,
  type ShotBox,
} from './framing';

/** A 1.75 m figure standing at the origin, facing +Z, in a relaxed stance. */
const figure: Landmarks = {
  eyes: [0, 1.62, 0.08],
  chin: [0, 1.5, 0.09],
  crown: 1.74,
  pelvis: [0, 0.98, 0],
  hands: [
    [0.3, 0.86, 0.02],
    [-0.28, 0.85, 0.02],
  ],
  knees: [
    [0.1, 0.5, 0.02],
    [-0.1, 0.5, 0.02],
  ],
  ankles: [
    [0.12, 0.08, -0.02],
    [-0.12, 0.08, -0.02],
  ],
  toes: [
    [0.14, 0.02, 0.12],
    [-0.14, 0.02, 0.12],
  ],
  floor: 0,
};

/** The same figure moved and scaled, as a shorter base or another idle pose leaves it. */
const scaled = (marks: Landmarks, s: number, dx = 0): Landmarks => {
  const p = (v: readonly [number, number, number]) => [v[0] * s + dx, v[1] * s, v[2] * s] as const;
  return {
    eyes: p(marks.eyes),
    chin: p(marks.chin),
    crown: marks.crown * s,
    pelvis: p(marks.pelvis),
    hands: [p(marks.hands[0]), p(marks.hands[1])],
    knees: [p(marks.knees[0]), p(marks.knees[1])],
    ankles: [p(marks.ankles[0]), p(marks.ankles[1])],
    toes: [p(marks.toes[0]), p(marks.toes[1])],
    floor: marks.floor * s,
  };
};

const SHOTS: ThumbShot[] = ['bust', 'brows', 'beard', 'mustache', 'top', 'bottom', 'shoes', 'full'];
const FOV = 24;
const RAD = Math.PI / 180;

/** Half the height and width the camera sees at the target's distance. */
function seen(box: ShotBox) {
  const pose = cameraFor(box, FOV);
  const distance = Math.hypot(
    pose.position[0] - pose.target[0],
    pose.position[1] - pose.target[1],
    pose.position[2] - pose.target[2],
  );
  return { pose, half: distance * Math.tan((FOV * RAD) / 2) };
}

describe('shotBox', () => {
  it('keeps every shot a non-empty region', () => {
    for (const shot of SHOTS) {
      const box = shotBox(shot, figure);
      expect(box.top, shot).toBeGreaterThan(box.bottom);
    }
  });

  it('frames the bust from above the crown (room for tall hair) to the upper chest', () => {
    const box = shotBox('bust', figure);
    expect(box.top).toBeGreaterThan(figure.crown + 0.08);
    expect(box.bottom).toBeLessThan(figure.chin[1] - 0.2);
    expect(box.bottom).toBeGreaterThan(figure.pelvis[1]);
  });

  it('keeps the brows, the beard and the mustache inside their close-ups', () => {
    const brows = shotBox('brows', figure);
    expect(brows.top).toBeGreaterThan(figure.eyes[1] + 0.05);
    expect(brows.bottom).toBeLessThan(figure.eyes[1]);
    const beard = shotBox('beard', figure);
    expect(beard.top).toBeLessThan(figure.eyes[1]);
    expect(beard.bottom).toBeLessThan(figure.chin[1] - 0.1);
    const mustache = shotBox('mustache', figure);
    expect(mustache.top).toBeLessThan(figure.eyes[1]);
    expect(mustache.bottom).toBeLessThan(figure.chin[1]);
    expect(mustache.top - mustache.bottom).toBeLessThan(beard.top - beard.bottom);
  });

  it('cuts a top at the chin and below the wrists, a bottom from the waist to the soles', () => {
    const top = shotBox('top', figure);
    expect(top.top).toBeLessThan(figure.eyes[1]);
    expect(top.bottom).toBeLessThan(figure.hands[1][1]);
    // Both sleeves to the cuff, whichever arm reaches further out.
    expect(top.halfWidth).toBeGreaterThan(figure.hands[0][0]);
    const bottom = shotBox('bottom', figure);
    expect(bottom.top).toBeGreaterThan(figure.pelvis[1]);
    expect(bottom.bottom).toBeLessThan(figure.floor);
  });

  it('fits both feet in the shoe shot and the whole figure in the full shot', () => {
    const shoes = shotBox('shoes', figure);
    expect(shoes.halfWidth).toBeGreaterThan(figure.toes[0][0]);
    expect(shoes.top).toBeLessThan(figure.knees[0][1]);
    const full = shotBox('full', figure);
    expect(full.top).toBeGreaterThan(figure.crown);
    expect(full.bottom).toBeLessThan(figure.floor);
  });

  it('scales head shots with the head, so a smaller head gets a closer camera', () => {
    const small = scaled(figure, 0.9);
    expect(headHeight(small)).toBeCloseTo(headHeight(figure) * 0.9);
    for (const shot of ['bust', 'brows', 'beard', 'mustache'] as const) {
      const big = shotBox(shot, figure);
      const little = shotBox(shot, small);
      expect(little.top - little.bottom, shot).toBeCloseTo((big.top - big.bottom) * 0.9);
    }
  });

  it('follows the head when the pose moves it sideways', () => {
    const swayed = scaled(figure, 1, 0.03);
    expect(shotBox('bust', swayed).x).toBeCloseTo(shotBox('bust', figure).x + 0.03);
    expect(shotBox('shoes', swayed).x).toBeCloseTo(shotBox('shoes', figure).x + 0.03);
  });
});

describe('cameraFor', () => {
  it('fits the taller span of the box exactly in a square view', () => {
    for (const shot of SHOTS) {
      const box = shotBox(shot, figure);
      const { half } = seen(box);
      expect(half, shot).toBeCloseTo(Math.max((box.top - box.bottom) / 2, box.halfWidth), 6);
    }
  });

  it('keeps the top edge of a top-anchored box when the width sets the size', () => {
    const box = { ...shotBox('top', figure), halfWidth: 1 };
    const { pose, half } = seen(box);
    expect(half).toBeCloseTo(1);
    expect(pose.target[1] + half).toBeCloseTo(box.top);
    const centred = cameraFor({ ...box, anchor: 'centre' }, FOV);
    expect(centred.target[1]).toBeCloseTo((box.top + box.bottom) / 2);
  });

  it('aims at the box centre from the shot yaw and pitch', () => {
    const box = shotBox('shoes', figure);
    const { pose } = seen(box);
    expect(pose.target[1]).toBeCloseTo((box.top + box.bottom) / 2);
    expect(pose.position[0]).toBeGreaterThan(pose.target[0]);
    expect(pose.position[1]).toBeGreaterThan(pose.target[1]);
    expect(pose.position[2]).toBeGreaterThan(pose.target[2]);
    const front = cameraFor({ ...box, yaw: 0, pitch: 0 }, FOV);
    expect(front.position[0]).toBeCloseTo(front.target[0]);
    expect(front.position[1]).toBeCloseTo(front.target[1]);
  });

  it('is the same camera for every item of a category on the same figure', () => {
    // Only landmarks go in: nothing about the item can move the camera.
    const a = cameraFor(shotBox('top', figure), FOV);
    const b = cameraFor(shotBox('top', { ...figure }), FOV);
    expect(poseDistance(a, b)).toBe(0);
  });
});

describe('squareFov', () => {
  it('keeps the camera field of view for a wide canvas and narrows it for a tall one', () => {
    expect(squareFov(24, 1024, 512)).toBeCloseTo(24);
    expect(squareFov(24, 512, 512)).toBeCloseTo(24);
    const tall = squareFov(24, 512, 1024);
    expect(Math.tan((tall * RAD) / 2)).toBeCloseTo(Math.tan(12 * RAD) / 2);
  });
});
