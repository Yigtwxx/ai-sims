import { describe, expect, it } from 'vitest';

import { hairLength } from './hairLength';

describe('hairLength', () => {
  it('reads the length code of a manifest groom id', () => {
    expect(hairLength('groom.hair.Hair_S_BuzzCut')).toBe('short');
    expect(hairLength('groom.hair.Hair_M_BobStraight')).toBe('medium');
    expect(hairLength('groom.hair.Hair_L_AfroCurly')).toBe('long');
  });

  it('reads a bare groom name too', () => {
    expect(hairLength('Hair_L_Straight')).toBe('long');
  });

  it('has no length for names without the code', () => {
    expect(hairLength('Hair_BantuKnots')).toBeUndefined();
    expect(hairLength('groom.hair.Hair_X_Odd')).toBeUndefined();
    expect(hairLength('groom.beard.Beard_L_Full')).toBeUndefined();
    expect(hairLength('')).toBeUndefined();
  });

  it('only looks after the last dot', () => {
    expect(hairLength('Hair_S_.groom.Custom')).toBeUndefined();
  });
});
