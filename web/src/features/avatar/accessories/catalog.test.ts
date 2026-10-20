import { describe, expect, it } from 'vitest';

import {
  ACCESSORIES,
  ACCESSORY_PALETTES,
  ACCESSORY_SLOTS,
  accessoriesFor,
  findAccessory,
  resolveAccessoryColor,
  resolveSelections,
} from './catalog';

const HEX = /^#[0-9a-f]{6}$/;

describe('accessory catalogue', () => {
  it('has unique ids on known slots and colour roles', () => {
    const ids = ACCESSORIES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const def of ACCESSORIES) {
      expect(ACCESSORY_SLOTS).toContain(def.slot);
      expect(Object.keys(ACCESSORY_PALETTES)).toContain(def.colorRole);
    }
  });

  it('offers items for every slot', () => {
    for (const slot of ACCESSORY_SLOTS) expect(accessoriesFor(slot).length).toBeGreaterThan(0);
    expect(accessoriesFor('helix').map((a) => a.id)).toEqual([
      'helix-ring',
      'helix-studs',
      'industrial-bar',
      'tragus-stud',
    ]);
  });

  it('uses valid lowercase hex palettes with the default first', () => {
    for (const palette of Object.values(ACCESSORY_PALETTES)) {
      expect(palette.length).toBeGreaterThan(0);
      for (const hex of palette) expect(hex).toMatch(HEX);
      expect(new Set(palette).size).toBe(palette.length);
    }
    expect(ACCESSORY_PALETTES.metal).toHaveLength(4);
  });

  it('defaults every item to a swatch of its own palette', () => {
    for (const def of ACCESSORIES)
      expect(ACCESSORY_PALETTES[def.colorRole]).toContain(def.defaultColor);
  });

  it('finds items by id', () => {
    expect(findAccessory('face-sunglasses')).toMatchObject({ slot: 'face', colorRole: 'lens' });
    expect(findAccessory('nope')).toBeUndefined();
  });
});

describe('selection resolution', () => {
  it('accepts valid overrides and falls back to the default', () => {
    const hoop = findAccessory('ear-hoop-small')!;
    expect(resolveAccessoryColor(hoop, '#ABCDEF')).toBe('#abcdef');
    expect(resolveAccessoryColor(hoop, 'red')).toBe(hoop.defaultColor);
    expect(resolveAccessoryColor(hoop)).toBe(hoop.defaultColor);
  });

  it('keeps one item per slot and drops unknown ids', () => {
    const resolved = resolveSelections([
      { id: 'ear-hoop-small' },
      { id: 'mystery' },
      { id: 'ear-stud-gem' },
      { id: 'nose-ring', color: '#2c2c31' },
      { id: 'neck-pearls' },
    ]);
    expect(resolved.map((r) => r.def.id)).toEqual(['ear-hoop-small', 'nose-ring', 'neck-pearls']);
    expect(resolved[1].color).toBe('#2c2c31');
  });
});
