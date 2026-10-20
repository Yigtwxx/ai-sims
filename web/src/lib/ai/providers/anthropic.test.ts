// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProviderError, type ProviderFailureKind } from '../errors';
import type { ChatRequest } from '../types';

// The SDK is replaced by a fake client; its real error classes are kept so the
// typed-error mapping is exercised for real. No network is involved.
const sdk = vi.hoisted(() => ({
  clientOptions: [] as unknown[],
  endpoints: [] as string[],
  streamParams: [] as unknown[],
  streamOptions: [] as unknown[],
  nextStream: undefined as unknown,
}));

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  // Records which endpoint a call used: `messages` (standard) or `beta.messages`.
  const record = (endpoint: string) => (params: unknown, options: unknown) => {
    sdk.endpoints.push(endpoint);
    sdk.streamParams.push(params);
    sdk.streamOptions.push(options);
    return sdk.nextStream;
  };
  class FakeAnthropic {
    messages = { stream: record('messages') };
    beta = { messages: { stream: record('beta.messages') } };
    constructor(options: unknown) {
      sdk.clientOptions.push(options);
    }
  }
  return { ...actual, default: FakeAnthropic };
});

const { anthropicProvider, supportsServerSideFallback } = await import('./anthropic');
const actualSdk = await vi.importActual<typeof import('@anthropic-ai/sdk')>('@anthropic-ai/sdk');

const REQUEST: ChatRequest = {
  system: 'You are Mira.',
  messages: [
    { role: 'user', content: 'Merhaba' },
    { role: 'assistant', content: 'Selam!' },
    { role: 'user', content: 'Nasılsın?' },
  ],
};

const textDelta = (text: string) => ({
  type: 'content_block_delta',
  index: 1,
  delta: { type: 'text_delta', text },
});

interface FakeStreamOptions {
  stopReason?: string | null;
  failWith?: unknown;
}

function fakeStream(
  events: unknown[],
  { stopReason = 'end_turn', failWith }: FakeStreamOptions = {},
) {
  const abort = vi.fn();
  let ended = false;
  return {
    abort,
    get ended() {
      return ended;
    },
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
      if (failWith) throw failWith;
      ended = true;
    },
    finalMessage: async () => ({ stop_reason: stopReason }),
  };
}

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

beforeEach(() => {
  sdk.clientOptions.length = 0;
  sdk.endpoints.length = 0;
  sdk.streamParams.length = 0;
  sdk.streamOptions.length = 0;
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test-key');
  vi.stubEnv('ANTHROPIC_MODEL', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('anthropicProvider', () => {
  it('is configured only when ANTHROPIC_API_KEY is set', () => {
    expect(anthropicProvider.id).toBe('anthropic');
    expect(anthropicProvider.isConfigured()).toBe(true);
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expect(anthropicProvider.isConfigured()).toBe(false);
  });

  it('yields text deltas only and ignores thinking and bookkeeping events', async () => {
    sdk.nextStream = fakeStream([
      { type: 'message_start', message: {} },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      textDelta('İyiyim, '),
      textDelta(''),
      textDelta('teşekkürler.'),
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    ]);

    expect(await collect(anthropicProvider.stream(REQUEST))).toEqual(['İyiyim, ', 'teşekkürler.']);
  });

  it('sends the Claude Haiku 5.5 request on the standard endpoint, with no server-side fallback', async () => {
    sdk.nextStream = fakeStream([textDelta('ok')]);
    const controller = new AbortController();

    await collect(anthropicProvider.stream({ ...REQUEST, signal: controller.signal }));

    expect(sdk.endpoints).toEqual(['messages']);
    const params = sdk.streamParams[0] as Record<string, unknown>;
    expect(params).toMatchObject({
      model: 'claude-haiku-5-5',
      system: 'You are Mira.',
      messages: REQUEST.messages,
      output_config: { effort: 'low' },
    });
    // Haiku 5.5 has no server-side fallback ('default' does nothing, a list is a 400), and it
    // rejects sampling parameters. Thinking stays unset: effort is the lever, not `disabled`.
    for (const absent of ['fallbacks', 'betas', 'thinking', 'temperature', 'top_p', 'top_k']) {
      expect(params).not.toHaveProperty(absent);
    }
    expect(params.max_tokens).toBeGreaterThanOrEqual(1024);
    // The conversation must end with a user turn: a trailing assistant turn is a rejected prefill.
    expect((params.messages as ChatRequest['messages']).at(-1)?.role).toBe('user');
    expect(sdk.streamOptions[0]).toEqual({ signal: controller.signal });
  });

  it('keeps the server-side refusal fallback on the beta endpoint for Claude Opus 5.5', async () => {
    vi.stubEnv('ANTHROPIC_MODEL', 'claude-opus-5-5');
    sdk.nextStream = fakeStream([textDelta('ok')]);

    await collect(anthropicProvider.stream(REQUEST));

    expect(sdk.endpoints).toEqual(['beta.messages']);
    const params = sdk.streamParams[0] as Record<string, unknown>;
    expect(params).toMatchObject({
      model: 'claude-opus-5-5',
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    // `thinking: {type: "disabled"}` is a 400 on Opus 5.5: the field must be omitted.
    expect(params).not.toHaveProperty('thinking');
  });

  it('creates the client with the key from the environment and SDK retries', async () => {
    sdk.nextStream = fakeStream([textDelta('ok')]);
    await collect(anthropicProvider.stream(REQUEST));
    expect(sdk.clientOptions[0]).toMatchObject({ apiKey: 'sk-ant-test-key', maxRetries: 2 });
  });

  it('uses ANTHROPIC_MODEL when it is set', async () => {
    vi.stubEnv('ANTHROPIC_MODEL', 'claude-sonnet-5-5');
    sdk.nextStream = fakeStream([textDelta('ok')]);
    await collect(anthropicProvider.stream(REQUEST));
    expect(sdk.streamParams[0]).toMatchObject({ model: 'claude-sonnet-5-5' });
    // Not a model we know a server-side fallback for: standard endpoint, no beta, no fallbacks.
    expect(sdk.endpoints).toEqual(['messages']);
    expect(sdk.streamParams[0]).not.toHaveProperty('fallbacks');
  });

  it('throws a refusal error when stop_reason is refusal and nothing was produced', async () => {
    sdk.nextStream = fakeStream([], { stopReason: 'refusal' });
    await expect(collect(anthropicProvider.stream(REQUEST))).rejects.toMatchObject({
      name: 'ProviderError',
      provider: 'anthropic',
      kind: 'refusal',
    });
  });

  it('delivers partial text before reporting a mid-stream refusal', async () => {
    sdk.nextStream = fakeStream([textDelta('Merha')], { stopReason: 'refusal' });
    const received: string[] = [];
    const run = async () => {
      for await (const chunk of anthropicProvider.stream(REQUEST)) received.push(chunk);
    };
    await expect(run()).rejects.toMatchObject({ kind: 'refusal' });
    expect(received).toEqual(['Merha']);
  });

  it('throws an empty-reply error when the turn ends without any text', async () => {
    sdk.nextStream = fakeStream([{ type: 'message_start', message: {} }], {
      stopReason: 'max_tokens',
    });
    await expect(collect(anthropicProvider.stream(REQUEST))).rejects.toMatchObject({
      kind: 'empty',
    });
  });

  it('cancels the upstream request when the consumer stops early', async () => {
    const stream = fakeStream([textDelta('a'), textDelta('b')]);
    sdk.nextStream = stream;

    const iterator = anthropicProvider.stream(REQUEST)[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();

    expect(stream.abort).toHaveBeenCalledTimes(1);
  });

  it('does not abort a stream that already finished', async () => {
    const stream = fakeStream([textDelta('a')]);
    sdk.nextStream = stream;
    await collect(anthropicProvider.stream(REQUEST));
    expect(stream.abort).not.toHaveBeenCalled();
  });

  describe('supportsServerSideFallback', () => {
    it('is true for Claude Opus 5.5 only among the models we know', () => {
      expect(supportsServerSideFallback('claude-opus-5-5')).toBe(true);
    });

    it('is false for Claude Haiku 5.5, older Haiku and unknown models', () => {
      for (const model of ['claude-haiku-5-5', 'claude-haiku-4-5', 'not-a-model', '']) {
        expect(supportsServerSideFallback(model)).toBe(false);
      }
    });
  });

  describe('typed SDK errors', () => {
    const headers = new Headers();
    const apiError = (status: number) =>
      actualSdk.APIError.generate(
        status,
        { type: 'error', error: { type: 'api_error', message: 'RAW-BODY-SECRET' } },
        `${status} RAW-BODY-SECRET`,
        headers,
      );

    it.each<[string, () => unknown, ProviderFailureKind, number | undefined]>([
      ['401', () => apiError(401), 'auth', 401],
      ['403', () => apiError(403), 'auth', 403],
      ['429', () => apiError(429), 'rate_limit', 429],
      ['500', () => apiError(500), 'server', 500],
      ['529 overloaded', () => apiError(529), 'server', 529],
      ['400 (e.g. credit balance too low)', () => apiError(400), 'bad_request', 400],
      ['404 (unknown model)', () => apiError(404), 'bad_request', 404],
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
          new actualSdk.AnthropicError('Request was aborted.', {
            cause: new TypeError('terminated', {
              cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
            }),
          }),
        'network',
        undefined,
      ],
      ['unexpected error', () => new TypeError('RAW-BODY-SECRET'), 'unknown', undefined],
    ])('maps %s to a secret-free ProviderError', async (_name, makeError, kind, status) => {
      sdk.nextStream = fakeStream([], { failWith: makeError() });

      const error = await collect(anthropicProvider.stream(REQUEST)).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ProviderError);
      expect(error).toMatchObject({ provider: 'anthropic', kind, status });
      expect((error as Error).message).not.toContain('RAW-BODY-SECRET');
    });
  });
});
