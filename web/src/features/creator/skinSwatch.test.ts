import { describe, expect, it } from 'vitest';

import {
  groupByToneBand,
  parseHex,
  stageShades,
  stageSwatchBackground,
  toneBand,
} from './skinSwatch';

const distance = (a: string, b: string) => {
  const [x, y] = [parseHex(a), parseHex(b)];
  if (!x || !y) throw new Error('bad colour');
  return Math.max(...x.map((channel, index) => Math.abs(channel - y[index])));
};

describe('stageShades', () => {
  // Measured on the creator stage (75th luminance percentile of the face skin).
  it.each([
    ['#c58266', '#d68e70'], // Aera
    ['#8d5844', '#945b46'], // Etta
    ['#663b2d', '#6a4030'], // Ada
  ])('puts the lit tone of %s near the rendered %s', (albedo, rendered) => {
    expect(distance(stageShades(albedo).lit, rendered)).toBeLessThanOrEqual(10);
  });

  it('orders shadow, lit and highlight from dark to light', () => {
    for (const albedo of ['#c48877', '#8d5642', '#4b281d']) {
      const { shadow, lit, highlight } = stageShades(albedo);
      const [s, l, h] = [shadow, lit, highlight].map((color) => parseHex(color)!);
      const sum = (rgb: readonly number[]) => rgb[0] + rgb[1] + rgb[2];
      expect(sum(s)).toBeLessThan(sum(l));
      expect(sum(l)).toBeLessThan(sum(h));
    }
  });

  it('builds a lit-sphere background from valid hex colours', () => {
    expect(stageSwatchBackground('#a46b5a')).toMatch(
      /^radial-gradient\(circle at 34% 30%, #[0-9a-f]{6} 0%, #[0-9a-f]{6} 42%, #[0-9a-f]{6} 100%\)$/,
    );
  });

  it('falls back to grey for a malformed swatch instead of throwing', () => {
    expect(() => stageShades('nope')).not.toThrow();
  });
});

describe('tone bands', () => {
  it.each([
    [0, 'light'],
    [0.449, 'light'],
    [0.45, 'medium'],
    [0.749, 'medium'],
    [0.75, 'deep'],
    [1, 'deep'],
  ] as const)('puts tone %s in %s', (tone, band) => {
    expect(toneBand(tone)).toBe(band);
  });

  it('groups in band order, keeps item order and leaves out empty bands', () => {
    const items = [
      { id: 'a', tone: 0.2 },
      { id: 'b', tone: 0.9 },
      { id: 'c', tone: 0.3 },
    ];
    expect(groupByToneBand(items)).toEqual([
      { band: 'light', items: [items[0], items[2]] },
      { band: 'deep', items: [items[1]] },
    ]);
  });
});
