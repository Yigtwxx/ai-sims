import { BufferAttribute, BufferGeometry, CylinderGeometry, LatheGeometry, Vector2 } from 'three';
import { describe, expect, it } from 'vitest';

import { BODY_HIDDEN } from './garments';
import { cuffGeometry, cuffProfile } from './sockCuff';
import { LEG_HEIGHT } from './socks';

/** A body's UV density on the legs, along and around (UV units per metre). */
const UV_PER_METRE = 0.65;

/**
 * A 10 cm leg of radius 5 cm standing on y = 0, with the attributes a body has;
 * `twist` (radians per metre up) turns its UV seam into a slant.
 */
function leg(hiddenBelow = -1, twist = 0): BufferGeometry {
  const geometry = new CylinderGeometry(0.05, 0.05, 0.1, 24, 10, true);
  geometry.translate(0, 0.05, 0);
  const turned = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  for (let v = 0; v < turned.count; v += 1) {
    const angle = twist * turned.getY(v);
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
    for (const attribute of [turned, normal]) {
      const [x, z] = [attribute.getX(v), attribute.getZ(v)];
      attribute.setX(v, x * cos - z * sin);
      attribute.setZ(v, x * sin + z * cos);
    }
  }
  // Around from 0 to 1 and up from 0 to 1: rescaled to the body's density.
  const uv = geometry.getAttribute('uv');
  for (let v = 0; v < uv.count; v += 1) {
    uv.setXY(v, uv.getX(v) * 2 * Math.PI * 0.05 * UV_PER_METRE, uv.getY(v) * 0.1 * UV_PER_METRE);
  }
  return withBodyAttributes(geometry, hiddenBelow);
}

/** A leg whose radius at height y is `radiusAt(y)`, curving like a calf into the ankle. */
function curvedLeg(radiusAt: (y: number) => number): BufferGeometry {
  const points = Array.from(
    { length: 41 },
    (_, k) => new Vector2(radiusAt(k * 0.0025), k * 0.0025),
  );
  const geometry = new LatheGeometry(points, 96);
  const uv = geometry.getAttribute('uv');
  for (let v = 0; v < uv.count; v += 1) {
    uv.setXY(v, uv.getX(v) * 2 * Math.PI * 0.045 * UV_PER_METRE, uv.getY(v) * 0.1 * UV_PER_METRE);
  }
  return withBodyAttributes(geometry, -1);
}

function withBodyAttributes(geometry: BufferGeometry, hiddenBelow: number): BufferGeometry {
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
  it('rings the leg at the edge, standing off it and tucking down under the skin', () => {
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
    expect(lowest).toBeCloseTo(0.055 - 0.015 - 0.0012, 3);
    // The cylinder's flat sides sit a little inside the radius; the roll is ~2 mm thick.
    expect(thickest).toBeGreaterThan(0.0015);
    expect(thickest).toBeLessThan(0.0025);
    // Around the whole leg: 24 sides crossed, two triangles each, five columns on each.
    expect(position.count).toBe(48 * 5 * PROFILE.points.length);
  });

  it('sits its lower rows on the skin at their own height, however the leg curves', () => {
    // Straight down from the edge the taper would end 2 mm inside the skin, and
    // along the skin's slope at the edge 0.5 mm inside it.
    const radiusAt = (y: number) => 0.04 + 4 * (0.07 - y) ** 2;
    const cuff = cuffGeometry(curvedLeg(radiusAt), 0.0551, PROFILE)!;
    const position = cuff.getAttribute('position');
    const rows = PROFILE.points.length;
    for (let v = 0; v < position.count; v += 1) {
      const above = Math.hypot(position.getX(v), position.getZ(v)) - radiusAt(position.getY(v));
      // The end of the taper: half a millimetre over the skin all round.
      if (v % rows === rows - 2) {
        expect(above).toBeGreaterThan(0.0004);
        expect(above).toBeLessThan(0.0006);
      }
      // Its last row is under the skin, so no facet pokes through the seam.
      if (v % rows === rows - 1) expect(above).toBeLessThan(0);
    }
  });

  it('keeps each column on one UV island across a seam', () => {
    // The cylinder's UVs jump from all the way round back to 0 where it closes;
    // twisted, the seam slants under the edge, and lower rows reach across it.
    const cuff = cuffGeometry(leg(-1, 10), 0.055, PROFILE)!;
    const uv = cuff.getAttribute('uv');
    const rows = PROFILE.points.length;
    for (let v = 0; v < uv.count; v += 1) {
      const top = v - (v % rows);
      expect(Math.abs(uv.getX(v) - uv.getX(top))).toBeLessThan(0.01);
    }
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
  it('rolls knit thicker than the waistband of tights, and ends under the skin', () => {
    const knit = cuffProfile('cotton', 0.015).points;
    const nylon = cuffProfile('nylon', 0.025).points;
    const thickness = (points: typeof knit) => Math.max(...points.map(([out]) => out));
    expect(thickness(knit)).toBeGreaterThan(thickness(nylon));
    expect(knit.at(-2)![1]).toBeCloseTo(-0.015);
    expect(knit.at(-2)![0]).toBeLessThan(0.001);
    expect(knit.at(-1)![0]).toBeLessThan(0);
    expect(knit.at(-1)![1]).toBeLessThan(-0.015);
  });
});
