import { describe, expect, it } from 'vitest';

import { fixtureManifest } from '@/features/creator/fixtures/manifest';

import {
  CURATION_TABS,
  groupNearDuplicates,
  itemsFor,
  keptLabel,
  labelStem,
  matchesQuery,
  matchesVisibility,
  previewConfig,
  summarizeAuto,
  type CurationItem,
  type CurationTab,
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

describe('pre-pass helpers', () => {
  const manifest = fixtureManifest();
  const pick = (keep: string, keepLabel = 'Kept') =>
    ({ keep, keepLabel, distance: 0.4, unit: 'mm' }) as const;
  const auto = { A: pick('K'), B: pick('K') };

  it('filters by visibility, the pre-pass filter keeping restored picks', () => {
    const hidden = new Set(['A', 'C']);
    const ids = ['A', 'B', 'C', 'D'];
    const shown = (filter: Parameters<typeof matchesVisibility>[1]) =>
      ids.filter((id) => matchesVisibility(id, filter, hidden, auto));
    expect(shown('all')).toEqual(ids);
    expect(shown('visible')).toEqual(['B', 'D']);
    expect(shown('hidden')).toEqual(['A', 'C']);
    expect(shown('auto')).toEqual(['A', 'B']);
  });

  it('does not treat inherited object keys as picks', () => {
    expect(matchesVisibility('toString', 'auto', new Set(), {})).toBe(false);
  });

  it('counts picks per tab, in all and still hidden, ignoring ids not in the manifest', () => {
    const byTab = Object.fromEntries(
      CURATION_TABS.map((tab) => [tab, itemsFor(manifest, tab, 'en')]),
    ) as Record<CurationTab, CurationItem[]>;
    const [brow] = byTab.eyebrows;
    const [beard] = byTab.beards;
    const summary = summarizeAuto(
      byTab,
      { [brow.id]: pick('x'), [beard.id]: pick('y'), 'groom.hair.Gone': pick('z') },
      new Set([brow.id]),
    );
    expect(summary.total).toBe(2);
    expect(summary.hidden).toBe(1);
    expect(summary.perTab.eyebrows).toBe(1);
    expect(summary.perTab.beards).toBe(1);
    expect(summary.perTab.hair).toBe(0);
  });

  it('names the kept item from the manifest, falling back to the English label', () => {
    const outfit = manifest.outfits.find((entry) => entry.id === 'Top_Hoodie')!;
    expect(keptLabel(manifest, pick(outfit.id, 'Hoodie EN'), 'tr')).toBe('Kapüşonlu');
    expect(keptLabel(manifest, pick(outfit.id, 'Hoodie EN'), 'en')).toBe('Hoodie');
    expect(keptLabel(manifest, pick('groom.gone.Gone', 'Gone Groom'), 'tr')).toBe('Gone Groom');
    const animation = manifest.animations[0];
    expect(keptLabel(manifest, pick(animation.id), 'en')).toBe(animation.id.replace(/[_-]+/g, ' '));
  });
});
