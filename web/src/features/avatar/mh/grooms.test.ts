import { BufferAttribute, BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';

import {
  cardForest,
  fitCards,
  headGraph,
  headNormals,
  headPositionTable,
  headSurface,
  keepCardDepth,
  refitPositions,
  strandProgress,
  STRAND_U,
} from './grooms';

/** Head primitive: DNA positions 0..2 on vertices 0..2, position 1 duplicated at a UV seam (vertex 3). */
function head(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([0, 1, 0, 1, 1, 0, 0, 2, 0, 1, 1, 0]), 3),
  );
  geometry.setAttribute('_dna_position', new BufferAttribute(new Float32Array([0, 1, 2, 1]), 1));
  return geometry;
}

/** One card: a root quad edge on the skin and a tip 0.1 m out, bound to the head triangle. */
function card(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([0, 1, 0, 1, 1, 0, 0, 1, 0.1, 1, 1, 0.1]), 3),
  );
  geometry.setAttribute(
    '_bind_positions',
    new BufferAttribute(new Float32Array([0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2]), 3),
  );
  geometry.setAttribute(
    '_bind_weights',
    new BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0]), 3),
  );
  geometry.setAttribute(
    '_bind_offset',
    new BufferAttribute(new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0, 0, 0.1]), 3),
  );
  geometry.setIndex([0, 1, 2, 1, 3, 2]);
  return geometry;
}

describe('headPositionTable', () => {
  it('maps every DNA position to its rest position', () => {
    const table = headPositionTable(head())!;
    expect([...table.slice(3, 6)]).toEqual([1, 1, 0]);
    expect([...table.slice(6, 9)]).toEqual([0, 2, 0]);
  });

  it('is null for a primitive without DNA positions', () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
    expect(headPositionTable(geometry)).toBeNull();
  });
});

describe('refitPositions', () => {
  it('reproduces the cards on the head they were fitted to', () => {
    const cards = card();
    const out = new Float32Array(12);
    expect(refitPositions(cards, headPositionTable(head())!, out)).toBe(0);
    expect([...out]).toEqual([...(cards.getAttribute('position').array as Float32Array)]);
  });

  it('follows a head whose skin moved', () => {
    const moved = head();
    // The whole head 2 cm forward.
    const position = moved.getAttribute('position') as BufferAttribute;
    for (let v = 0; v < position.count; v += 1) position.setZ(v, position.getZ(v) + 0.02);
    const out = new Float32Array(12);
    refitPositions(card(), headPositionTable(moved)!, out);
    expect(out[2]).toBeCloseTo(0.02);
    expect(out[8]).toBeCloseTo(0.12);
  });

  it('keeps the loaded position where the head lacks a bound position', () => {
    const partial = head();
    partial.setAttribute('_dna_position', new BufferAttribute(new Float32Array([0, 0, 0, 0]), 1));
    const out = new Float32Array(12);
    expect(refitPositions(card(), headPositionTable(partial)!, out)).toBe(4);
    expect(out[8]).toBeCloseTo(0.1);
  });
});

describe('strandProgress', () => {
  it('runs from 0 at the root to 1 at the tip of each card', () => {
    const progress = strandProgress(card());
    expect(progress[0]).toBe(0);
    expect(progress[3]).toBe(1);
    // The other root vertex sits one card width away, still short of the tip.
    expect(progress[1]).toBeLessThan(progress[3]!);
  });
});

/**
 * A 3 x 3 grid of skin `lift` metres up (DNA positions 0-8, normal +z; 4 is
 * inside, the rest on its open edge) and a root anchor below it that stays
 * put (position 9; below, so the skin faces up).
 */
function skin(lift = 0): BufferGeometry {
  const geometry = new BufferGeometry();
  const at: number[] = [];
  for (let y = 0; y < 3; y += 1) for (let x = 0; x < 3; x += 1) at.push(x, y, lift);
  at.push(5, 5, -1);
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(at), 3));
  geometry.setAttribute(
    '_dna_position',
    new BufferAttribute(new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), 1),
  );
  const index: number[] = [];
  for (const r of [0, 1]) {
    for (const c of [0, 1]) {
      const a = r * 3 + c;
      index.push(a, a + 1, a + 4, a, a + 4, a + 3);
    }
  }
  geometry.setIndex(index);
  return geometry;
}

/**
 * Cards over the skin's inner vertex, rooted at the anchor. Piece A: vertex 0
 * designed 1 mm over the skin, vertex 1 3 mm (it follows 0), vertex 2 a tip
 * 10 cm out with no depth of its own (it follows 1). Piece B, split from A at
 * a seam: vertex 3 a copy of vertex 1, vertex 4 its tip. `tear` (metres along
 * x) moves piece B the way a root of its own would.
 */
function hoveringCard(tear = 0): BufferGeometry {
  const geometry = new BufferGeometry();
  const at = [1, 1, 0.001, 1.1, 0.9, 0.003, 1.1, 0.9, 0.1, 1.1, 0.9, 0.003, 1.15, 0.9, 0.05];
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(at), 3));
  geometry.setAttribute(
    '_bind_positions',
    new BufferAttribute(new Float32Array(Array.from({ length: 15 }, () => 9)), 3),
  );
  geometry.setAttribute(
    '_bind_weights',
    new BufferAttribute(new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]), 3),
  );
  const offset = at.map((value, i) =>
    i % 3 === 2 ? value + 1 : value - 5 + (i >= 9 && i % 3 === 0 ? tear : 0),
  );
  geometry.setAttribute('_bind_offset', new BufferAttribute(new Float32Array(offset), 3));
  geometry.setAttribute(
    '_surface_depth',
    new BufferAttribute(new Int16Array([4, 100, 4, 300, 0, -32768, 0, 32767, 0, -32768]), 2),
  );
  geometry.setAttribute('_surface_parent', new BufferAttribute(new Int16Array([0, 1, 1, 2, 1]), 1));
  geometry.setIndex([0, 1, 2, 0, 3, 4]);
  return geometry;
}

function refit(cards: BufferGeometry, lift: number): Float32Array {
  const out = new Float32Array(15);
  refitPositions(cards, headPositionTable(skin(lift))!, out);
  return out;
}

describe('headNormals', () => {
  it('points every DNA position outward, whatever the winding', () => {
    // An octahedron wound inward.
    const geometry = new BufferGeometry();
    const corners = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1];
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(corners), 3));
    geometry.setAttribute(
      '_dna_position',
      new BufferAttribute(new Float32Array([0, 1, 2, 3, 4, 5]), 1),
    );
    geometry.setIndex([0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4, 2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5]);
    const normals = headNormals(geometry, headPositionTable(geometry)!)!;
    for (let p = 0; p < 6; p += 1) {
      for (let c = 0; c < 3; c += 1) expect(normals[p * 3 + c]).toBeCloseTo(corners[p * 3 + c]!);
    }
  });

  it('is null without triangles', () => {
    expect(headSurface(head())!.normals).toBeNull();
  });
});

describe('headGraph', () => {
  it('links DNA positions along the triangle edges and marks the open edge', () => {
    const graph = headGraph(skin(), 10);
    expect([...graph.boundary]).toEqual([1, 1, 1, 1, 0, 1, 1, 1, 1, 0]);
    const around = graph.neighbours.subarray(graph.neighbourStart[4], graph.neighbourStart[5]);
    expect([...around]).toEqual([0, 1, 3, 5, 7, 8]);
  });
});

describe('cardForest', () => {
  it('orders every vertex after the one it follows and marks seam copies', () => {
    const forest = cardForest(hoveringCard())!;
    expect([...forest.parent]).toEqual([-1, 0, 1, 1, 3]);
    expect([...forest.copy]).toEqual([0, 0, 0, 1, 0]);
    expect([...forest.point]).toEqual([0, 1, 2, 1, 4]);
    const at = new Map([...forest.order].map((v, i) => [v, i]));
    for (const [v, p] of forest.parent.entries()) {
      if (p >= 0) expect(at.get(p)!).toBeLessThan(at.get(v)!);
    }
  });

  it('folds copies into their point for the smoothing edges', () => {
    const forest = cardForest(hoveringCard())!;
    expect([...forest.edgeEnd]).not.toContain(3);
    expect(forest.edgeStart[4]! - forest.edgeStart[3]!).toBe(0);
  });

  it('is null for cards without a designed depth', () => {
    expect(cardForest(card())).toBeNull();
  });
});

describe('keepCardDepth', () => {
  it('leaves cards on the skin they were designed on alone', () => {
    const cards = hoveringCard();
    const positions = refit(cards, 0);
    const before = [...positions];
    expect(keepCardDepth(cards, headSurface(skin(0))!, cardForest(cards)!, positions)).toBe(0);
    expect([...positions]).toEqual(before);
  });

  it('pushes a card the skin rose under back out, the tips and the copy following', () => {
    const cards = hoveringCard();
    // The skin 5 mm higher while the root stays: the card sits 2-4 mm under it.
    const positions = refit(cards, 0.005);
    keepCardDepth(cards, headSurface(skin(0.005))!, cardForest(cards)!, positions);
    // Back to 1 mm and 3 mm over the skin, less the 0.5 mm slack.
    expect(positions[2]).toBeCloseTo(0.0055, 6);
    expect(positions[5]).toBeCloseTo(0.0075, 6);
    expect(positions[8]).toBeCloseTo(0.1045, 6);
    expect(positions[14]).toBeCloseTo(0.0545, 6);
    expect([...positions.slice(9, 12)]).toEqual([...positions.slice(3, 6)]);
    expect(positions[0]).toBeCloseTo(1, 6);
  });

  it('puts a piece torn off at a seam back on, whole', () => {
    const cards = hoveringCard(0.02);
    const positions = refit(cards, 0);
    expect(positions[9]).toBeCloseTo(1.12, 6);
    expect(keepCardDepth(cards, headSurface(skin(0))!, cardForest(cards)!, positions)).toBe(2);
    expect([...positions.slice(9, 12)]).toEqual([...positions.slice(3, 6)]);
    expect(positions[12]).toBeCloseTo(1.15, 6);
  });

  it('never pulls a card in', () => {
    const cards = hoveringCard();
    const positions = refit(cards, -0.005);
    const before = [...positions];
    keepCardDepth(cards, headSurface(skin(-0.005))!, cardForest(cards)!, positions);
    expect([...positions]).toEqual(before);
  });
});

describe('fitCards', () => {
  it('keeps the designed depth when given the card forest', () => {
    const cards = hoveringCard();
    const fitted = fitCards(
      cards,
      headSurface(skin(0.005)),
      strandProgress(cards),
      cardForest(cards),
    );
    expect(fitted.getAttribute('position').getZ(1)).toBeCloseTo(0.0075, 6);
  });

  it('owns refitted positions and adds the strand coordinate, sharing the rest', () => {
    const cards = card();
    const fitted = fitCards(cards, headSurface(head()), strandProgress(cards));
    expect(fitted.getAttribute('position')).not.toBe(cards.getAttribute('position'));
    expect(fitted.getAttribute('_bind_offset')).toBe(cards.getAttribute('_bind_offset'));
    expect(fitted.getAttribute(STRAND_U).count).toBe(4);
  });

  it('bounds the fitted cards without walking their morph targets', () => {
    const cards = card();
    // A face morph that would throw the sphere 100 m out if it were included.
    cards.morphAttributes.position = [new BufferAttribute(new Float32Array(12).fill(100), 3)];
    cards.morphTargetsRelative = true;
    const fitted = fitCards(cards, headSurface(head()), strandProgress(cards));
    expect(fitted.morphAttributes.position).toBe(cards.morphAttributes.position);
    expect(fitted.boundingSphere!.radius).toBeLessThan(1);
  });

  it('wears the cards as loaded without a head table', () => {
    const cards = card();
    const fitted = fitCards(cards, null, strandProgress(cards));
    expect([...(fitted.getAttribute('position').array as Float32Array)]).toEqual([
      ...(cards.getAttribute('position').array as Float32Array),
    ]);
  });
});
