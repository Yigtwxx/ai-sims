import { BufferAttribute, BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';

import { fitCards, headPositionTable, refitPositions, strandProgress, STRAND_U } from './grooms';

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

describe('fitCards', () => {
  it('owns refitted positions and adds the strand coordinate, sharing the rest', () => {
    const cards = card();
    const fitted = fitCards(cards, headPositionTable(head()), strandProgress(cards));
    expect(fitted.getAttribute('position')).not.toBe(cards.getAttribute('position'));
    expect(fitted.getAttribute('_bind_offset')).toBe(cards.getAttribute('_bind_offset'));
    expect(fitted.getAttribute(STRAND_U).count).toBe(4);
  });

  it('wears the cards as loaded without a head table', () => {
    const cards = card();
    const fitted = fitCards(cards, null, strandProgress(cards));
    expect([...(fitted.getAttribute('position').array as Float32Array)]).toEqual([
      ...(cards.getAttribute('position').array as Float32Array),
    ]);
  });
});
