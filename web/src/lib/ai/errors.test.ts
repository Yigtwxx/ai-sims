// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { isAbortError, isNetworkError, kindFromStatus, ProviderError, toFailure } from './errors';

describe('kindFromStatus', () => {
  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [408, 'timeout'],
    [429, 'rate_limit'],
    [500, 'server'],
    [503, 'server'],
    [529, 'server'],
    [400, 'bad_request'],
    [404, 'bad_request'],
    [413, 'bad_request'],
    [422, 'bad_request'],
    [302, 'unknown'],
  ] as const)('maps HTTP %i to %s', (status, kind) => {
    expect(kindFromStatus(status)).toBe(kind);
  });

  it('treats a missing status as a network failure', () => {
    expect(kindFromStatus(undefined)).toBe('network');
  });
});

describe('isNetworkError', () => {
  it('recognises undici fetch failures', () => {
    expect(isNetworkError(new TypeError('fetch failed'))).toBe(true);
    expect(isNetworkError(new TypeError('terminated'))).toBe(true);
  });

  it('recognises socket error codes', () => {
    const error = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    expect(isNetworkError(error)).toBe(true);
  });

  it('finds the cause when an SDK wraps the transport error', () => {
    const socket = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' });
    const wrapped = new Error('Request was aborted by the connection', {
      cause: new TypeError('terminated', { cause: socket }),
    });
    expect(isNetworkError(wrapped)).toBe(true);
  });

  it('ignores unrelated errors and non-errors', () => {
    expect(isNetworkError(new RangeError('out of range'))).toBe(false);
    expect(isNetworkError(new TypeError('x is not a function'))).toBe(false);
    expect(isNetworkError('fetch failed')).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
  });

  it('stops following a circular cause chain', () => {
    const a: Error = new Error('a');
    const b: Error = new Error('b', { cause: a });
    Object.assign(a, { cause: b });
    expect(isNetworkError(a)).toBe(false);
  });
});

describe('isAbortError', () => {
  it('matches errors named AbortError only', () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(isAbortError(abort)).toBe(true);
    expect(isAbortError(new Error('aborted'))).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });
});

describe('toFailure', () => {
  it('keeps only provider, kind and status of a ProviderError', () => {
    expect(toFailure('groq', new ProviderError('anthropic', 'rate_limit', 429))).toEqual({
      provider: 'groq',
      kind: 'rate_limit',
      status: 429,
    });
    expect(toFailure('groq', new ProviderError('groq', 'network'))).toEqual({
      provider: 'groq',
      kind: 'network',
    });
  });

  it('never exposes the message of an unknown error', () => {
    expect(toFailure('gemini', new Error('Bearer sk-secret'))).toEqual({
      provider: 'gemini',
      kind: 'unknown',
    });
  });
});

describe('ProviderError', () => {
  it('has a message made of the provider, kind and status only', () => {
    expect(new ProviderError('anthropic', 'rate_limit', 429).message).toBe(
      'anthropic request failed: rate_limit (HTTP 429)',
    );
    expect(new ProviderError('groq', 'refusal').message).toBe('groq request failed: refusal');
  });
});
