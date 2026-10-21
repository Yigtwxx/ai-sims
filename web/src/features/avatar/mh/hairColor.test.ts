import { describe, expect, it } from 'vitest';

import { absorptionToColor, colorToAbsorption, hairColor, type Rgb } from './hairColor';

describe('hairColor', () => {
  it('is white without melanin or dye', () => {
    for (const channel of hairColor(0, 0.5)) expect(channel).toBeCloseTo(1);
  });

  it('gets darker with more melanin', () => {
    const light = hairColor(0.2, 0.3);
    const dark = hairColor(0.8, 0.3);
    for (let i = 0; i < 3; i += 1) expect(dark[i]!).toBeLessThan(light[i]!);
  });

  it('turns redder with redness at the same melanin', () => {
    const brown = hairColor(0.4, 0);
    const red = hairColor(0.4, 1);
    expect(red[0] / red[2]).toBeGreaterThan(brown[0] / brown[2]);
  });

  it('maps a colour to absorption and back', () => {
    const color: Rgb = [0.6, 0.3, 0.1];
    const back = absorptionToColor(colorToAbsorption(color));
    back.forEach((channel, i) => expect(channel).toBeCloseTo(color[i]!, 5));
  });

  it('dyes white hair to the dye colour', () => {
    const dye: Rgb = [0.2, 0.5, 0.8];
    hairColor(0, 0, dye).forEach((channel, i) => expect(channel).toBeCloseTo(dye[i]!, 5));
  });
});
