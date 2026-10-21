import { describe, expect, it } from 'vitest';

import { QUALITY, stepDown } from './quality';

describe('stepDown', () => {
  it('walks high -> balanced -> battery and stays at battery', () => {
    expect(stepDown('high')).toBe('balanced');
    expect(stepDown('balanced')).toBe('battery');
    expect(stepDown('battery')).toBe('battery');
  });

  it('gets cheaper at every step', () => {
    const [high, balanced, battery] = [QUALITY.high, QUALITY.balanced, QUALITY.battery];
    expect(balanced.dpr[1]).toBeLessThan(high.dpr[1]);
    expect(battery.dpr[1]).toBeLessThan(balanced.dpr[1]);
    expect(battery.ao).toBeNull();
    expect(battery.maxFps).toBe(30);
  });
});
