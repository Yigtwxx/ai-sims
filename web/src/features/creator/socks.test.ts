import { describe, expect, it } from 'vitest';

import { createDefaultConfig } from '@/lib/character/defaults';
import { NUDE_TIGHTS_COLOR } from '@/lib/character/schema';

import { SOCK_COLORS, TIGHTS_COLORS } from './palettes';
import { restyleSocks, sockPalette } from './socks';

const socks = createDefaultConfig('female').socks;

describe('sockPalette', () => {
  it('offers knit colours for socks and nude or dark shades for tights', () => {
    expect(sockPalette('knee')).toBe(SOCK_COLORS);
    expect(sockPalette('tights')).toBe(TIGHTS_COLORS);
    expect(TIGHTS_COLORS[0]?.value).toBe(NUDE_TIGHTS_COLOR);
  });
});

describe('restyleSocks', () => {
  it('keeps a colour the new length offers', () => {
    const black = { ...socks, style: 'knee' as const, color: '#1b1b1d' };
    expect(restyleSocks(black, 'ankle')).toEqual({ ...black, style: 'ankle' });
  });

  it("falls back to the new length's first colour, keeping the sheerness", () => {
    const navy = { style: 'knee' as const, color: '#22304a', sheer: 0.3 };
    expect(restyleSocks(navy, 'tights')).toEqual({
      style: 'tights',
      color: NUDE_TIGHTS_COLOR,
      sheer: 0.3,
    });
    const nude = { style: 'tights' as const, color: NUDE_TIGHTS_COLOR, sheer: 0.3 };
    expect(restyleSocks(nude, 'ankle').color).toBe(SOCK_COLORS[0]?.value);
  });
});
