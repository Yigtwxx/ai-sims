import { describe, expect, it } from 'vitest';

import { normalizeTurkish, textToVisemes } from './turkish';

const visemesOf = (text: string) => textToVisemes(text).map((s) => s.viseme);

describe('normalizeTurkish', () => {
  it('lowercases dotted and dotless I with Turkish rules', () => {
    expect(normalizeTurkish('IŞIK İNCİ')).toBe('ışık inci');
  });
});

describe('textToVisemes', () => {
  it('maps a simple word letter by letter', () => {
    expect(visemesOf('merhaba')).toEqual(['PP', 'E', 'RR', 'kk', 'aa', 'PP', 'aa']);
  });

  it('closes the lips on m, b and p', () => {
    expect(visemesOf('bum').filter((v) => v === 'PP')).toHaveLength(2);
    expect(visemesOf('pa')[0]).toBe('PP');
  });

  it('maps every Turkish vowel to a vowel viseme', () => {
    expect(visemesOf('a e ı i o ö u ü').filter((v) => v !== 'sil')).toEqual([
      'aa',
      'E',
      'I',
      'I',
      'O',
      'O',
      'U',
      'U',
    ]);
  });

  it('lengthens the previous vowel for soft g instead of adding a shape', () => {
    const [plain] = textToVisemes('a');
    const segments = textToVisemes('ağ');
    expect(segments).toHaveLength(1);
    expect(segments[0].weight).toBeGreaterThan(plain.weight);
  });

  it('merges doubled letters into one longer hold', () => {
    const single = textToVisemes('dikat');
    const doubled = textToVisemes('dikkat');
    expect(doubled.map((s) => s.viseme)).toEqual(single.map((s) => s.viseme));
    expect(doubled[2].weight).toBeGreaterThan(single[2].weight);
  });

  it('turns punctuation into pauses of increasing length', () => {
    const comma = textToVisemes('a, a').find((s) => s.viseme === 'sil')!;
    const period = textToVisemes('a. a').find((s) => s.viseme === 'sil')!;
    const space = textToVisemes('a a').find((s) => s.viseme === 'sil')!;
    expect(period.weight).toBeGreaterThan(comma.weight);
    expect(comma.weight).toBeGreaterThan(space.weight);
  });

  it('trims leading and trailing silence', () => {
    const v = visemesOf('  ...merhaba!  ');
    expect(v[0]).not.toBe('sil');
    expect(v.at(-1)).not.toBe('sil');
  });

  it('returns nothing for empty or symbol-only input', () => {
    expect(textToVisemes('')).toEqual([]);
    expect(textToVisemes('123 #')).toEqual([]);
  });
});
