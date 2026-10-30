import { describe, expect, it } from 'vitest';

import { ACCESSORIES, ACCESSORY_SLOTS, accessoriesFor, findAccessory } from './catalog';

import messages from '../../../../messages/en.json';
import tr from '../../../../messages/tr.json';

describe('accessory catalogue', () => {
  it('has unique ids on known slots with a hex colour', () => {
    const ids = ACCESSORIES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const def of ACCESSORIES) {
      expect(ACCESSORY_SLOTS).toContain(def.slot);
      expect(def.defaultColor).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('offers items for every slot', () => {
    for (const slot of ACCESSORY_SLOTS) expect(accessoriesFor(slot).length).toBeGreaterThan(0);
    expect(accessoriesFor('finger').map((a) => a.id)).toEqual([
      'ring-band',
      'ring-solitaire',
      'ring-signet',
    ]);
  });

  it('finds items by id', () => {
    expect(findAccessory('ear-hoop-small')?.slot).toBe('ears');
    expect(findAccessory('face-glasses-round')).toBeUndefined();
  });

  it('labels every slot and item in both languages', () => {
    for (const bundle of [messages, tr]) {
      const jewelry = bundle.Creator.jewelry as {
        slots: Record<string, string>;
        items: Record<string, string>;
      };
      for (const slot of ACCESSORY_SLOTS) expect(jewelry.slots[slot], slot).toBeTruthy();
      for (const def of ACCESSORIES) expect(jewelry.items[def.id], def.id).toBeTruthy();
      expect(Object.keys(jewelry.items).sort()).toEqual(ACCESSORIES.map((a) => a.id).sort());
    }
  });
});
