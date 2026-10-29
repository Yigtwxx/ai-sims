import { BufferAttribute, BufferGeometry, CylinderGeometry } from 'three';
import { describe, expect, it } from 'vitest';

import { BODY_HIDDEN } from './garments';
import { cuffGeometry, cuffProfile } from './sockCuff';
import { LEG_HEIGHT } from './socks';

/** A 10 cm leg of radius 5 cm standing on y = 0, with the attributes a body has. */
function leg(hiddenBelow = -1): BufferGeometry {
  const geometry = new CylinderGeometry(0.05, 0.05, 0.1, 24, 10, true);
  geometry.translate(0, 0.05, 0);
  const position = geometry.getAttribute('position');
  const count = position.count;
  const heights = new Float32Array(count);
  const hidden = new Float32Array(count);
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  for (let v = 0; v < count; v += 1) {
    heights[v] = position.getY(v);
    hidden[v] = position.getY(v) < hiddenBelow ? 1 : 0;
    // Two bones: the lower one holds the bottom, the upper one the top.
    const up = position.getY(v) / 0.1;
    skinIndex.set([0, 1, 0, 0], v * 4);
    skinWeight.set([1 - up, up, 0, 0], v * 4);
  }
  geometry.setAttribute(LEG_HEIGHT, new BufferAttribute(heights, 1));
  geometry.setAttribute(BODY_HIDDEN, new BufferAttribute(hidden, 1));
  geometry.setAttribute('skinIndex', new BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(skinWeight, 4));
  geometry.morphAttributes.position = [
    new BufferAttribute(new Float32Array(count * 3).fill(0.01), 3),
  ];
  geometry.morphTargetsRelative = true;
  return geometry;
}

const PROFILE = cuffProfile('cotton', 0.015);

describe('cuffGeometry', () => {
  it('rings the leg at the edge, standing off it and tapering down into the sock', () => {
    const cuff = cuffGeometry(leg(), 0.055, PROFILE)!;
    const position = cuff.getAttribute('position');
    let lowest = Infinity;
    let highest = -Infinity;
    let thickest = 0;
    for (let v = 0; v < position.count; v += 1) {
      lowest = Math.min(lowest, position.getY(v));
      highest = Math.max(highest, position.getY(v));
      thickest = Math.max(thickest, Math.hypot(position.getX(v), position.getZ(v)) - 0.05);
    }
    expect(highest).toBeCloseTo(0.055, 3);
    expect(lowest).toBeCloseTo(0.055 - 0.015, 3);
    // The cylinder's flat sides sit a little inside the radius; the roll is ~2 mm thick.
    expect(thickest).toBeGreaterThan(0.0015);
    expect(thickest).toBeLessThan(0.0025);
    // Around the whole leg: 24 sides crossed, two triangles each.
    expect(position.count).toBe(48 * 2 * PROFILE.points.length);
  });

  it('is drawn as sock and keeps the skin weights and morphs of the leg there', () => {
    const cuff = cuffGeometry(leg(), 0.055, PROFILE)!;
    const heights = cuff.getAttribute(LEG_HEIGHT);
    const weights = cuff.getAttribute('skinWeight');
    for (let v = 0; v < heights.count; v += 1) {
      expect(heights.getX(v)).toBeLessThan(0.055);
      expect(weights.getX(v) + weights.getY(v)).toBeCloseTo(1, 5);
    }
    // At 5.5 cm up the upper bone holds 55 %.
    const upper = Array.from({ length: weights.count }, (_, v) =>
      cuff.getAttribute('skinIndex').getX(v) === 1 ? weights.getX(v) : weights.getY(v),
    );
    expect(Math.max(...upper)).toBeCloseTo(0.55, 1);
    expect(cuff.morphAttributes.position![0]!.getX(0)).toBeCloseTo(0.01);
    expect(cuff.morphTargetsRelative).toBe(true);
  });

  it('is hidden where the skin under it is', () => {
    const covered = cuffGeometry(leg(0.08), 0.055, PROFILE)!.getAttribute(BODY_HIDDEN);
    expect(Array.from(covered.array).every((value) => value === 1)).toBe(true);
    const bare = cuffGeometry(leg(), 0.055, PROFILE)!.getAttribute(BODY_HIDDEN);
    expect(Array.from(bare.array).every((value) => value === 0)).toBe(true);
  });

  it('builds nothing where no triangle crosses the edge', () => {
    expect(cuffGeometry(leg(), 0.2, PROFILE)).toBeNull();
  });
});

describe('cuffProfile', () => {
  it('rolls knit thicker than the waistband of tights, and ends on the skin', () => {
    const knit = cuffProfile('cotton', 0.015).points;
    const nylon = cuffProfile('nylon', 0.025).points;
    const thickness = (points: typeof knit) => Math.max(...points.map(([out]) => out));
    expect(thickness(knit)).toBeGreaterThan(thickness(nylon));
    expect(knit.at(-1)![1]).toBeCloseTo(-0.015);
    expect(knit.at(-1)![0]).toBeLessThan(0.0005);
  });
});
