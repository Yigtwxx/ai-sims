export interface RetryOptions {
  /** Pause before each retry in milliseconds; the number of entries is the number of retries. */
  delaysMs: readonly number[];
  /** Whether a failure is worth another attempt. */
  shouldRetry: (error: unknown) => boolean;
  /** Stops retrying (and waiting) when the caller is gone. */
  signal?: AbortSignal;
}

/** Waits `ms`, or less if the signal aborts first. */
function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });
  });
}

/**
 * Runs `attempt`, retrying with exponential-style delays (plus up to 20% jitter
 * so concurrent callers do not retry in lockstep). The last error is thrown
 * when retries run out, when it is not retryable, or when the caller aborted.
 */
export async function withRetry<T>(
  attempt: () => Promise<T>,
  { delaysMs, shouldRetry, signal }: RetryOptions,
): Promise<T> {
  for (let retry = 0; ; retry += 1) {
    try {
      return await attempt();
    } catch (error) {
      const delay = delaysMs[retry];
      if (delay === undefined || !shouldRetry(error) || signal?.aborted) throw error;

      await pause(delay * (0.8 + Math.random() * 0.4), signal);
      if (signal?.aborted) throw error;
    }
  }
}
