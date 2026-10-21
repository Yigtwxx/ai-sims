import { describe, expect, it } from 'vitest';

import { skinToneGain } from './skinTone';

describe('skinToneGain', () => {
  it('leaves the skin set untouched at the neutral tone', () => {
    expect(skinToneGain(0)).toEqual([1, 1, 1]);
  });

  it('darkens every channel and blue most when the tone goes darker', () => {
    const [r, g, b] = skinToneGain(1);
    expect(r).toBeLessThan(1);
    expect(b).toBeLessThan(g);
    expect(g).toBeLessThan(r);
  });

  it('lightens every channel when the tone goes lighter', () => {
    const [r, g, b] = skinToneGain(-1);
    expect(Math.min(r, g, b)).toBeGreaterThan(1);
  });

  it('stays within the slider range for values beyond it', () => {
    expect(skinToneGain(3)).toEqual(skinToneGain(1));
    expect(skinToneGain(-3)).toEqual(skinToneGain(-1));
  });
});
