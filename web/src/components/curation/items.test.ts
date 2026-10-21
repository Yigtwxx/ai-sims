import { describe, expect, it } from 'vitest';

import { fixtureManifest } from '@/features/creator/fixtures/manifest';

import {
  groupNearDuplicates,
  itemsFor,
  labelStem,
  matchesQuery,
  previewConfig,
  type CurationItem,
} from './items';

const item = (id: string, label: string): CurationItem => ({
  id,
  label,
  meta: [],
  glyph: 'groom',
});

describe('labelStem', () => {
  it('drops numbers, variant words and bracketed suffixes', () => {
    expect(labelStem('Long Straight 02')).toBe('long straight');
    expect(labelStem('T Shirt Variant 3 (Navy)')).toBe('t shirt');
    expect(labelStem('Hair_Bob_v2')).toBe('hair bob');
  });
});

describe('groupNearDuplicates', () => {
  it('collects variants under one stem and keeps order', () => {
    const groups = groupNearDuplicates([
      item('a', 'Long Straight 01'),
      item('b', 'Buzz Cut'),
      item('c', 'Long Straight 02'),
      item('d', 'Long Straight Bangs'),
      item('e', 'Long Afro'),
    ]);
    expect(groups.map((group) => group.stem)).toEqual(['long straight', 'buzz cut', 'long afro']);
    expect(groups[0].items.map((member) => member.id)).toEqual(['a', 'c', 'd']);
  });
});

describe('matchesQuery', () => {
  it('ignores case and Turkish accents', () => {
    expect(matchesQuery(item('x', 'Kıvırcık Saç'), 'kivircik')).toBe(true);
    expect(matchesQuery(item('x', 'Bob'), 'afro')).toBe(false);
    expect(matchesQuery(item('x', 'Bob'), '  ')).toBe(true);
  });
});

describe('itemsFor', () => {
  const manifest = fixtureManifest();

  it('lists grooms per slot and outfits with their colourways', () => {
    expect(itemsFor(manifest, 'beards', 'tr').every((entry) => entry.id.startsWith('Beard_'))).toBe(
      true,
    );
    const hoodie = itemsFor(manifest, 'outfits', 'tr').find((entry) => entry.id === 'Top_Hoodie');
    expect(hoodie).toMatchObject({ label: 'Kapüşonlu', category: 'top', tints: 3 });
  });

  it('builds a preview character wearing the item', () => {
    const beard = previewConfig(manifest, 'beards', 'Beard_Full');
    expect(beard).toMatchObject({ base: 'male', beard: { style: 'Beard_Full' } });
    const hoodie = previewConfig(manifest, 'outfits', 'Top_Hoodie');
    expect(hoodie?.outfit.top).toEqual({ id: 'Top_Hoodie', tint: 'charcoal', colors: {} });
    expect(previewConfig(manifest, 'animations', manifest.animations[0].id)).toBeNull();
    expect(previewConfig(manifest, 'faces', 'Nobody')).toBeNull();
  });

  it('sorts skins from light to dark', () => {
    const tones = itemsFor(manifest, 'skins', 'en').map((entry) => entry.tone ?? -1);
    expect(tones).toEqual([...tones].sort((a, b) => a - b));
  });
});
