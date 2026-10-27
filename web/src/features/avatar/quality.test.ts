import { describe, expect, it } from 'vitest';

import { autoStep, frameCap, IDLE_FPS, QUALITY } from './quality';

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

describe('frameCap', () => {
  it('leaves the tier alone while someone is interacting', () => {
    expect(frameCap(null, false)).toBeNull();
    expect(frameCap(QUALITY.battery.maxFps, false)).toBe(30);
  });

  it('drops an uncapped tier to the idle rate', () => {
    expect(frameCap(QUALITY.high.maxFps, true)).toBe(IDLE_FPS);
    expect(frameCap(QUALITY.balanced.maxFps, true)).toBe(IDLE_FPS);
  });

  it('never raises a tier that is already capped lower', () => {
    expect(frameCap(24, true)).toBe(24);
  });
});
