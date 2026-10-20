// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AiNotConfiguredError,
  AiUnavailableError,
  ProviderError,
  type ProviderFailureKind,
} from './errors';
import { FIRST_TOKEN_TIMEOUT_MS, streamWithFallback } from './router';
import type { ChatProvider, ChatRequest, ProviderId } from './types';

const REQUEST: ChatRequest = {
  system: 'system prompt',
  messages: [{ role: 'user', content: 'hello' }],
};

interface FakeOptions {
  configured?: boolean;
}

/** A provider whose stream is the given async generator; `stream` is a spy. */
function fakeProvider(
  id: ProviderId,
  script: (request: ChatRequest) => AsyncGenerator<string>,
  { configured = true }: FakeOptions = {},
) {
  const stream = vi.fn((request: ChatRequest) => script(request));
  const provider: ChatProvider = { id, isConfigured: () => configured, stream };
  return { provider, stream };
}

async function* chunks(...values: string[]): AsyncGenerator<string> {
  for (const value of values) yield value;
}

function failing(kind: ProviderFailureKind, provider: ProviderId, status?: number) {
  return async function* (): AsyncGenerator<string> {
    throw new ProviderError(provider, kind, status);
  };
}

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('streamWithFallback', () => {
  it('streams from the first configured provider in order', async () => {
    const a = fakeProvider('anthropic', () => chunks('Mer', 'haba'));
    const g = fakeProvider('gemini', () => chunks('unused'));

    const result = await streamWithFallback(REQUEST, { providers: [a.provider, g.provider] });

    expect(result.provider).toBe('anthropic');
    expect(await collect(result.stream)).toEqual(['Mer', 'haba']);
    expect(g.stream).not.toHaveBeenCalled();
  });

  it('passes the system prompt and messages to the provider', async () => {
    const a = fakeProvider('anthropic', () => chunks('ok'));
    await streamWithFallback(REQUEST, { providers: [a.provider] });

    const received = a.stream.mock.calls[0]![0];
    expect(received.system).toBe('system prompt');
    expect(received.messages).toEqual(REQUEST.messages);
  });

  it('skips unconfigured providers without calling them', async () => {
    const a = fakeProvider('anthropic', () => chunks('unused'), { configured: false });
    const g = fakeProvider('gemini', () => chunks('hi'));

    const result = await streamWithFallback(REQUEST, { providers: [a.provider, g.provider] });

    expect(result.provider).toBe('gemini');
    expect(a.stream).not.toHaveBeenCalled();
  });

  it.each<[ProviderFailureKind, number | undefined]>([
    ['auth', 401],
    ['rate_limit', 429],
    ['server', 529],
    ['network', undefined],
    ['refusal', undefined],
  ])('moves on when the provider fails with %s before its first token', async (kind, status) => {
    const a = fakeProvider('anthropic', failing(kind, 'anthropic', status));
    const g = fakeProvider('gemini', () => chunks('from gemini'));

    const result = await streamWithFallback(REQUEST, { providers: [a.provider, g.provider] });

    expect(result.provider).toBe('gemini');
    expect(await collect(result.stream)).toEqual(['from gemini']);
    expect(a.stream).toHaveBeenCalledTimes(1);
  });

  it('moves on when a provider finishes without any text', async () => {
    const a = fakeProvider('anthropic', () => chunks());
    const g = fakeProvider('gemini', () => chunks('hi'));

    const result = await streamWithFallback(REQUEST, { providers: [a.provider, g.provider] });
    expect(result.provider).toBe('gemini');
  });

  it('does not count empty chunks as the first token', async () => {
    const a = fakeProvider('anthropic', () => chunks('', '', 'real'));
    const result = await streamWithFallback(REQUEST, { providers: [a.provider] });
    expect(await collect(result.stream)).toEqual(['real']);
  });

  it('never switches providers after the first token', async () => {
    const a = fakeProvider('anthropic', async function* () {
      yield 'Merha';
      throw new ProviderError('anthropic', 'network');
    });
    const g = fakeProvider('gemini', () => chunks('must not be used'));

    const result = await streamWithFallback(REQUEST, { providers: [a.provider, g.provider] });
    expect(result.provider).toBe('anthropic');

    const received: string[] = [];
    await expect(
      (async () => {
        for await (const chunk of result.stream) received.push(chunk);
      })(),
    ).rejects.toMatchObject({ kind: 'network' });

    expect(received).toEqual(['Merha']);
    expect(g.stream).not.toHaveBeenCalled();
  });

  it('throws AiNotConfiguredError when no provider has credentials', async () => {
    const a = fakeProvider('anthropic', () => chunks('x'), { configured: false });
    const g = fakeProvider('gemini', () => chunks('x'), { configured: false });

    await expect(
      streamWithFallback(REQUEST, { providers: [a.provider, g.provider] }),
    ).rejects.toBeInstanceOf(AiNotConfiguredError);
    await expect(streamWithFallback(REQUEST, { providers: [] })).rejects.toBeInstanceOf(
      AiNotConfiguredError,
    );
  });

  it('throws AiUnavailableError with every failure when all providers fail', async () => {
    const a = fakeProvider('anthropic', failing('rate_limit', 'anthropic', 429));
    const g = fakeProvider('gemini', failing('auth', 'gemini', 401));
    const q = fakeProvider('groq', () => chunks());

    const error = await streamWithFallback(REQUEST, {
      providers: [a.provider, g.provider, q.provider],
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AiUnavailableError);
    expect((error as AiUnavailableError).failures).toEqual([
      { provider: 'anthropic', kind: 'rate_limit', status: 429 },
      { provider: 'gemini', kind: 'auth', status: 401 },
      { provider: 'groq', kind: 'empty' },
    ]);
  });

  it('never leaks the message of an unexpected error into failures, logs or the thrown error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const secret = 'Bearer sk-ant-api03-SECRET {"error":"raw provider body"}';
    const a = fakeProvider('anthropic', async function* () {
      yield* [];
      throw new Error(secret);
    });

    const error = await streamWithFallback(REQUEST, { providers: [a.provider] }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(AiUnavailableError);
    expect(JSON.stringify([(error as Error).message, warn.mock.calls])).not.toContain('SECRET');
    expect((error as AiUnavailableError).failures).toEqual([
      { provider: 'anthropic', kind: 'unknown' },
    ]);
  });

  it('rethrows instead of failing over when the caller has aborted', async () => {
    const controller = new AbortController();
    const a = fakeProvider('anthropic', async function* () {
      yield* [];
      controller.abort();
      throw new ProviderError('anthropic', 'aborted');
    });
    const g = fakeProvider('gemini', () => chunks('must not be used'));

    await expect(
      streamWithFallback(
        { ...REQUEST, signal: controller.signal },
        { providers: [a.provider, g.provider] },
      ),
    ).rejects.toMatchObject({ kind: 'aborted' });
    expect(g.stream).not.toHaveBeenCalled();
  });

  it('does not start any provider when the request is already aborted', async () => {
    const a = fakeProvider('anthropic', () => chunks('x'));
    await expect(
      streamWithFallback({ ...REQUEST, signal: AbortSignal.abort() }, { providers: [a.provider] }),
    ).rejects.toBeDefined();
    expect(a.stream).not.toHaveBeenCalled();
  });

  it('abandons a provider that stalls before its first token, even if it ignores the abort signal', async () => {
    const a = fakeProvider('anthropic', async function* () {
      yield* [];
      await new Promise<never>(() => undefined); // never settles, never looks at the signal
    });
    const g = fakeProvider('gemini', () => chunks('fallback reply'));

    const result = await streamWithFallback(REQUEST, {
      providers: [a.provider, g.provider],
      firstTokenTimeoutMs: 20,
    });

    expect(result.provider).toBe('gemini');
    expect(a.stream.mock.calls[0]![0].signal?.aborted).toBe(true);
  });

  it('gives a stalled Gemini the short per-provider leash before falling back', async () => {
    vi.useFakeTimers();
    try {
      const g = fakeProvider('gemini', async function* () {
        yield* [];
        await new Promise<never>(() => undefined);
      });
      const a = fakeProvider('anthropic', () => chunks('fallback reply'));

      const pending = streamWithFallback(REQUEST, { providers: [g.provider, a.provider] });
      await vi.advanceTimersByTimeAsync(FIRST_TOKEN_TIMEOUT_MS.gemini - 1);
      expect(a.stream).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2);

      expect((await pending).provider).toBe('anthropic');
      expect(FIRST_TOKEN_TIMEOUT_MS.gemini).toBeLessThan(FIRST_TOKEN_TIMEOUT_MS.anthropic);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a first-token timeout as a timeout failure', async () => {
    const a = fakeProvider('anthropic', async function* () {
      yield* [];
      await new Promise<never>(() => undefined);
    });

    const error = await streamWithFallback(REQUEST, {
      providers: [a.provider],
      firstTokenTimeoutMs: 20,
    }).catch((e: unknown) => e);

    expect((error as AiUnavailableError).failures).toEqual([
      { provider: 'anthropic', kind: 'timeout' },
    ]);
  });

  it('forwards a later caller abort to the provider and cleans up when the consumer stops early', async () => {
    const controller = new AbortController();
    let cleanedUp = false;
    let providerSignal: AbortSignal | undefined;
    const a = fakeProvider('anthropic', async function* (request) {
      providerSignal = request.signal;
      try {
        yield 'first';
        yield 'second';
      } finally {
        cleanedUp = true;
      }
    });

    const result = await streamWithFallback(
      { ...REQUEST, signal: controller.signal },
      { providers: [a.provider] },
    );
    const iterator = result.stream[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ value: 'first', done: false });

    controller.abort();
    expect(providerSignal?.aborted).toBe(true);

    await iterator.return?.();
    await vi.waitFor(() => expect(cleanedUp).toBe(true));
  });
});
