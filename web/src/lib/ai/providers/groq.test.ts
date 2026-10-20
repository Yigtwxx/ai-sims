// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProviderError, type ProviderFailureKind } from '../errors';
import type { ChatRequest } from '../types';

// The SDK client is faked; its real error classes are kept. No network.
const sdk = vi.hoisted(() => ({
  clientOptions: [] as unknown[],
  requests: [] as unknown[],
  requestOptions: [] as unknown[],
  nextChunks: [] as unknown[],
  failWith: undefined as unknown,
  failBeforeStream: undefined as unknown,
  abort: undefined as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock('groq-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('groq-sdk')>();
  class FakeGroq {
    chat = {
      completions: {
        create: async (request: unknown, options: unknown) => {
          sdk.requests.push(request);
          sdk.requestOptions.push(options);
          if (sdk.failBeforeStream) throw sdk.failBeforeStream;
          return {
            controller: { abort: sdk.abort },
            async *[Symbol.asyncIterator]() {
              for (const chunk of sdk.nextChunks) yield chunk;
              if (sdk.failWith) throw sdk.failWith;
            },
          };
        },
      },
    };
    constructor(options: unknown) {
      sdk.clientOptions.push(options);
    }
  }
  return { ...actual, default: FakeGroq };
});

const { groqProvider } = await import('./groq');
const actualSdk = await vi.importActual<typeof import('groq-sdk')>('groq-sdk');

const REQUEST: ChatRequest = {
  system: 'You are Mira.',
  messages: [
    { role: 'user', content: 'Merhaba' },
    { role: 'assistant', content: 'Selam!' },
    { role: 'user', content: 'Nasılsın?' },
  ],
};

const delta = (fields: Record<string, unknown>, finishReason: string | null = null) => ({
  choices: [{ delta: fields, finish_reason: finishReason }],
});

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const part of stream) out.push(part);
  return out;
}

beforeEach(() => {
  sdk.clientOptions.length = 0;
  sdk.requests.length = 0;
  sdk.requestOptions.length = 0;
  sdk.nextChunks = [];
  sdk.failWith = undefined;
  sdk.failBeforeStream = undefined;
  sdk.abort = vi.fn();
  vi.stubEnv('GROQ_API_KEY', 'gsk_test_key');
  vi.stubEnv('GROQ_MODEL', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('groqProvider', () => {
  it('is configured only when GROQ_API_KEY is set', () => {
    expect(groqProvider.id).toBe('groq');
    expect(groqProvider.isConfigured()).toBe(true);
    vi.stubEnv('GROQ_API_KEY', '');
    expect(groqProvider.isConfigured()).toBe(false);
  });

  it('yields delta content and never the reasoning text', async () => {
    sdk.nextChunks = [
      delta({ role: 'assistant' }),
      delta({ reasoning: 'let me think about this' }),
      delta({ content: 'Ben ' }),
      delta({ content: null }),
      delta({ content: 'iyiyim.' }, 'stop'),
    ];
    expect(await collect(groqProvider.stream(REQUEST))).toEqual(['Ben ', 'iyiyim.']);
  });

  it('sends the system prompt first and low, hidden reasoning for the default gpt-oss model', async () => {
    sdk.nextChunks = [delta({ content: 'ok' }, 'stop')];
    const controller = new AbortController();
    await collect(groqProvider.stream({ ...REQUEST, signal: controller.signal }));

    expect(sdk.requests[0]).toMatchObject({
      model: 'openai/gpt-oss-120b',
      stream: true,
      reasoning_effort: 'low',
      include_reasoning: false,
      messages: [{ role: 'system', content: 'You are Mira.' }, ...REQUEST.messages],
    });
    expect(sdk.requestOptions[0]).toEqual({ signal: controller.signal });
  });

  it('creates the client with the key from the environment and SDK retries', async () => {
    sdk.nextChunks = [delta({ content: 'ok' }, 'stop')];
    await collect(groqProvider.stream(REQUEST));
    expect(sdk.clientOptions[0]).toMatchObject({ apiKey: 'gsk_test_key', maxRetries: 2 });
  });

  it('uses GROQ_MODEL and only sends reasoning parameters to gpt-oss models', async () => {
    vi.stubEnv('GROQ_MODEL', 'llama-3.3-70b-versatile');
    sdk.nextChunks = [delta({ content: 'ok' }, 'stop')];
    await collect(groqProvider.stream(REQUEST));

    const request = sdk.requests[0] as Record<string, unknown>;
    expect(request.model).toBe('llama-3.3-70b-versatile');
    expect(request).not.toHaveProperty('reasoning_effort');
    expect(request).not.toHaveProperty('include_reasoning');
  });

  it('throws an empty-reply error when no content arrives', async () => {
    sdk.nextChunks = [delta({ reasoning: 'only thinking' }, 'length')];
    await expect(collect(groqProvider.stream(REQUEST))).rejects.toMatchObject({
      provider: 'groq',
      kind: 'empty',
    });
  });

  it('aborts the HTTP stream when it is done or abandoned', async () => {
    sdk.nextChunks = [delta({ content: 'a' }), delta({ content: 'b' })];
    const iterator = groqProvider.stream(REQUEST)[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();
    expect(sdk.abort).toHaveBeenCalled();
  });

  describe('typed SDK errors', () => {
    const apiError = (status: number) =>
      actualSdk.APIError.generate(
        status,
        { error: { message: 'RAW-BODY-SECRET' } },
        `${status} RAW-BODY-SECRET`,
        new Headers(),
      );

    it.each<[string, () => unknown, ProviderFailureKind, number | undefined]>([
      ['401', () => apiError(401), 'auth', 401],
      ['429', () => apiError(429), 'rate_limit', 429],
      ['500', () => apiError(500), 'server', 500],
      ['503', () => apiError(503), 'server', 503],
      ['400', () => apiError(400), 'bad_request', 400],
      [
        'connection error',
        () => new actualSdk.APIConnectionError({ message: 'x' }),
        'network',
        undefined,
      ],
      ['connection timeout', () => new actualSdk.APIConnectionTimeoutError(), 'timeout', undefined],
      ['user abort', () => new actualSdk.APIUserAbortError(), 'aborted', undefined],
      [
        'a connection dropped mid-stream (plain SDK error wrapping a socket error)',
        () =>
          new actualSdk.GroqError('Request was aborted.', {
            cause: new TypeError('terminated', {
              cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
            }),
          }),
        'network',
        undefined,
      ],
      ['unexpected error', () => new RangeError('RAW-BODY-SECRET'), 'unknown', undefined],
    ])(
      'maps %s (thrown by the request) to a secret-free ProviderError',
      async (_n, make, kind, status) => {
        sdk.failBeforeStream = make();

        const error = await collect(groqProvider.stream(REQUEST)).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ProviderError);
        expect(error).toMatchObject({ provider: 'groq', kind, status });
        expect((error as Error).message).not.toContain('RAW-BODY-SECRET');
      },
    );

    it('maps errors thrown while streaming the same way', async () => {
      sdk.nextChunks = [delta({ content: 'partial' })];
      sdk.failWith = apiError(500);

      const error = await collect(groqProvider.stream(REQUEST)).catch((e: unknown) => e);

      expect(error).toMatchObject({ kind: 'server', status: 500 });
    });
  });
});
