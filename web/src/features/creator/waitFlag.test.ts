import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWaitFlag } from './waitFlag';

describe('createWaitFlag', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves at once when the flag is already up', async () => {
    const flag = createWaitFlag();
    flag.set(true);
    await expect(flag.wait(1000)).resolves.toBe(true);
  });

  it('resolves when the flag goes up, not when it goes down', async () => {
    const flag = createWaitFlag();
    let result: boolean | undefined;
    void flag.wait(1000).then((up) => {
      result = up;
    });
    flag.set(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(result).toBeUndefined();
    flag.set(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(result).toBe(true);
  });

  it('gives up after the timeout', async () => {
    const flag = createWaitFlag();
    const waiting = flag.wait(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(waiting).resolves.toBe(false);
    // A later rise no longer reaches the waiter that gave up.
    flag.set(true);
    expect(flag.value).toBe(true);
  });
});
