import { describe, expect, it } from 'vitest';

import { resolveVisibility } from './parts';

const BASE = '/base.vrm';
const DONOR_A = '/a.vrm';
const DONOR_B = '/b.vrm';

describe('resolveVisibility', () => {
  it('keeps the base outfit for categories that are not selected', () => {
    const { base, donors } = resolveVisibility(BASE, {}, false);
    expect([...base].sort()).toEqual(['bottom', 'hair', 'shoes', 'top']);
    expect(donors.size).toBe(0);
  });

  it('hides a category when it is explicitly set to none', () => {
    const { base } = resolveVisibility(BASE, { top: null }, false);
    expect(base.has('top')).toBe(false);
  });

  it('groups several categories from the same donor into one instance', () => {
    const { base, donors } = resolveVisibility(
      BASE,
      { top: DONOR_A, bottom: DONOR_A, hair: DONOR_B },
      false,
    );
    expect([...donors.get(DONOR_A)!].sort()).toEqual(['bottom', 'top']);
    expect([...donors.get(DONOR_B)!]).toEqual(['hair']);
    expect([...base].sort()).toEqual(['shoes']);
  });

  it('treats a donor URL equal to the base as the base outfit', () => {
    const { base, donors } = resolveVisibility(BASE, { shoes: BASE }, false);
    expect(base.has('shoes')).toBe(true);
    expect(donors.size).toBe(0);
  });

  it('drops the bottom slot when the top is a one-piece', () => {
    const { base, donors } = resolveVisibility(BASE, { top: DONOR_A, bottom: DONOR_B }, true);
    expect(base.has('bottom')).toBe(false);
    expect(donors.has(DONOR_B)).toBe(false);
  });
});
