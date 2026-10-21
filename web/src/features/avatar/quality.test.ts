import { describe, expect, it } from 'vitest';

import { autoStep, QUALITY } from './quality';

describe('autoStep', () => {
  it('steps down to balanced and no further', () => {
    expect(autoStep('high', 'down')).toBe('balanced');
    expect(autoStep('balanced', 'down')).toBe('balanced');
  });

  it('steps back up when the frame rate recovers', () => {
    expect(autoStep('balanced', 'up')).toBe('high');
    expect(autoStep('high', 'up')).toBe('high');
  });

  it('gets cheaper at every step', () => {
    const [high, balanced, battery] = [QUALITY.high, QUALITY.balanced, QUALITY.battery];
    expect(balanced.dpr[1]).toBeLessThan(high.dpr[1]);
    expect(battery.dpr[1]).toBeLessThan(balanced.dpr[1]);
    expect(battery.ao).toBeNull();
    expect(battery.maxFps).toBe(30);
  });
});
