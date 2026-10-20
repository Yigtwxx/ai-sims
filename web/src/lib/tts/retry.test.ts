// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { withRetry } from './retry';

const always = () => true;

describe('withRetry', () => {
  it('returns the first success without retrying', async () => {
    const attempt = vi.fn(async () => 'ok');
    await expect(withRetry(attempt, { delaysMs: [0, 0], shouldRetry: always })).resolves.toBe('ok');
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('retries a retryable failure and returns the later success', async () => {
    const attempt = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce(new Error('second'))
      .mockResolvedValueOnce('ok');

    await expect(withRetry(attempt, { delaysMs: [0, 0], shouldRetry: always })).resolves.toBe('ok');
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('gives up after the configured number of retries and throws the last error', async () => {
    const attempt = vi.fn(async () => {
      throw new Error(`attempt ${attempt.mock.calls.length}`);
    });

    await expect(withRetry(attempt, { delaysMs: [0, 0], shouldRetry: always })).rejects.toThrow(
      'attempt 3',
    );
    expect(attempt).toHaveBeenCalledTimes(3); // 1 try + 2 retries
  });

  it('does not retry at all when there are no delays', async () => {
    const attempt = vi.fn(async () => {
      throw new Error('boom');
    });
    await expect(withRetry(attempt, { delaysMs: [], shouldRetry: always })).rejects.toThrow('boom');
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('does not retry a failure that is not retryable', async () => {
    const attempt = vi.fn(async () => {
      throw new Error('fatal');
    });
    await expect(
      withRetry(attempt, {
        delaysMs: [0, 0],
        shouldRetry: (e) => (e as Error).message !== 'fatal',
      }),
    ).rejects.toThrow('fatal');
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('waits roughly the configured delay between attempts', async () => {
    vi.useFakeTimers();
    try {
      const attempt = vi
        .fn<() => Promise<string>>()
        .mockRejectedValueOnce(new Error('x'))
        .mockResolvedValueOnce('ok');
      const result = withRetry(attempt, { delaysMs: [1000], shouldRetry: always });

      await vi.advanceTimersByTimeAsync(700); // below the minimum of 800 ms (1000 ms - 20% jitter)
      expect(attempt).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(600); // past the maximum of 1200 ms
      await expect(result).resolves.toBe('ok');
      expect(attempt).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops waiting and retrying as soon as the caller aborts', async () => {
    const controller = new AbortController();
    const attempt = vi.fn(async () => {
      throw new Error('boom');
    });

    const result = withRetry(attempt, {
      delaysMs: [60_000, 60_000],
      shouldRetry: always,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 10);

    await expect(result).rejects.toThrow('boom');
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('does not retry when the signal is already aborted', async () => {
    const attempt = vi.fn(async () => {
      throw new Error('boom');
    });
    await expect(
      withRetry(attempt, { delaysMs: [0], shouldRetry: always, signal: AbortSignal.abort() }),
    ).rejects.toThrow('boom');
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
