// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProviderError, type ProviderFailureKind } from '../errors';
import type { ChatRequest } from '../types';

// The SDK client is faked; enums and the real ApiError class are kept. No network.
const sdk = vi.hoisted(() => ({
  clientOptions: [] as unknown[],
  requests: [] as unknown[],
  nextChunks: [] as unknown[],
  failWith: undefined as unknown,
  failBeforeStream: undefined as unknown,
}));

vi.mock('@google/genai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@google/genai')>();
  class FakeGoogleGenAI {
    models = {
      generateContentStream: async (request: unknown) => {
        sdk.requests.push(request);
        if (sdk.failBeforeStream) throw sdk.failBeforeStream;
        return (async function* () {
          for (const chunk of sdk.nextChunks) yield chunk;
          if (sdk.failWith) throw sdk.failWith;
        })();
      },
    };
    constructor(options: unknown) {
      sdk.clientOptions.push(options);
    }
  }
  return { ...actual, GoogleGenAI: FakeGoogleGenAI };
});

const { geminiProvider, thinkingLevelFor } = await import('./gemini');
const { ApiError, FinishReason, ThinkingLevel } =
  await vi.importActual<typeof import('@google/genai')>('@google/genai');

const REQUEST: ChatRequest = {
  system: 'You are Mira.',
  messages: [
    { role: 'user', content: 'Merhaba' },
    { role: 'assistant', content: 'Selam!' },
    { role: 'user', content: 'Nasılsın?' },
  ],
};

const chunk = (text: string | undefined, finishReason?: string) => ({
  text,
  candidates: finishReason ? [{ finishReason }] : [{}],
});

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const part of stream) out.push(part);
  return out;
}

beforeEach(() => {
  sdk.clientOptions.length = 0;
  sdk.requests.length = 0;
  sdk.nextChunks = [];
  sdk.failWith = undefined;
  sdk.failBeforeStream = undefined;
  vi.stubEnv('GEMINI_API_KEY', 'gemini-test-key');
  vi.stubEnv('GEMINI_MODEL', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('geminiProvider', () => {
  it('is configured only when GEMINI_API_KEY is set', () => {
    expect(geminiProvider.id).toBe('gemini');
    expect(geminiProvider.isConfigured()).toBe(true);
    vi.stubEnv('GEMINI_API_KEY', '');
    expect(geminiProvider.isConfigured()).toBe(false);
  });

  it('yields chunk text and skips empty chunks', async () => {
    sdk.nextChunks = [chunk('Ben '), chunk(undefined), chunk(''), chunk('iyiyim.', 'STOP')];
    expect(await collect(geminiProvider.stream(REQUEST))).toEqual(['Ben ', 'iyiyim.']);
  });

  it('maps roles to user/model and sends the system prompt as systemInstruction', async () => {
    sdk.nextChunks = [chunk('ok', 'STOP')];
    const controller = new AbortController();
    await collect(geminiProvider.stream({ ...REQUEST, signal: controller.signal }));

    expect(sdk.requests[0]).toMatchObject({
      model: 'gemini-3.5-flash-lite',
      contents: [
        { role: 'user', parts: [{ text: 'Merhaba' }] },
        { role: 'model', parts: [{ text: 'Selam!' }] },
        { role: 'user', parts: [{ text: 'Nasılsın?' }] },
      ],
      config: {
        systemInstruction: 'You are Mira.',
        abortSignal: controller.signal,
        // Flash-Lite spends no thinking tokens at MINIMAL, which keeps the first token fast.
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      },
    });
  });

  it('creates the client with the key from the environment and bounded retries', async () => {
    sdk.nextChunks = [chunk('ok', 'STOP')];
    await collect(geminiProvider.stream(REQUEST));
    expect(sdk.clientOptions[0]).toMatchObject({
      apiKey: 'gemini-test-key',
      httpOptions: { retryOptions: { attempts: 3 } },
    });
  });

  it('uses GEMINI_MODEL and only sends thinkingLevel to Gemini 3 models', async () => {
    vi.stubEnv('GEMINI_MODEL', 'gemini-2.5-flash');
    sdk.nextChunks = [chunk('ok', 'STOP')];
    await collect(geminiProvider.stream(REQUEST));

    const request = sdk.requests[0] as { model: string; config: Record<string, unknown> };
    expect(request.model).toBe('gemini-2.5-flash');
    expect(request.config).not.toHaveProperty('thinkingConfig');
  });

  it('falls back to LOW thinking for a model that rejects MINIMAL', async () => {
    vi.stubEnv('GEMINI_MODEL', 'gemini-3.8-flash');
    sdk.nextChunks = [chunk('ok', 'STOP')];
    await collect(geminiProvider.stream(REQUEST));

    expect(sdk.requests[0]).toMatchObject({
      model: 'gemini-3.8-flash',
      config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    });
  });

  it('throws a refusal error when the prompt is blocked', async () => {
    sdk.nextChunks = [{ promptFeedback: { blockReason: 'SAFETY' } }];
    await expect(collect(geminiProvider.stream(REQUEST))).rejects.toMatchObject({
      provider: 'gemini',
      kind: 'refusal',
    });
  });

  it('throws a refusal error when generation stops on a safety finish reason', async () => {
    sdk.nextChunks = [chunk(undefined, FinishReason.SAFETY)];
    await expect(collect(geminiProvider.stream(REQUEST))).rejects.toMatchObject({
      kind: 'refusal',
    });
  });

  it('delivers partial text before reporting a mid-stream safety stop', async () => {
    sdk.nextChunks = [chunk('Merha'), chunk(undefined, FinishReason.PROHIBITED_CONTENT)];
    const received: string[] = [];
    const run = async () => {
      for await (const part of geminiProvider.stream(REQUEST)) received.push(part);
    };
    await expect(run()).rejects.toMatchObject({ kind: 'refusal' });
    expect(received).toEqual(['Merha']);
  });

  it('throws an empty-reply error when no text arrives', async () => {
    sdk.nextChunks = [chunk(undefined, FinishReason.MAX_TOKENS)];
    await expect(collect(geminiProvider.stream(REQUEST))).rejects.toMatchObject({
      kind: 'empty',
    });
  });

  describe('thinkingLevelFor', () => {
    it.each([
      ['gemini-3.5-flash-lite', ThinkingLevel.MINIMAL],
      ['gemini-3.1-flash-lite', ThinkingLevel.MINIMAL],
      ['gemini-3.5-flash', ThinkingLevel.MINIMAL],
      ['gemini-3.6-flash', ThinkingLevel.MINIMAL],
      // gemini-3.7-flash, gemini-3.8-flash and gemini-flash-latest answer MINIMAL with a 400.
      ['gemini-3.7-flash', ThinkingLevel.LOW],
      ['gemini-3.8-flash', ThinkingLevel.LOW],
      // Unknown future 3.x models get the level every 3.x model accepted so far.
      ['gemini-3.9-flash', ThinkingLevel.LOW],
      ['gemini-3-pro', ThinkingLevel.LOW],
    ])('picks the accepted level for %s', (model, expected) => {
      expect(thinkingLevelFor(model)).toBe(expected);
    });

    it.each(['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest', 'gemma-3'])(
      'leaves the API default for %s (thinkingBudget models and moving aliases)',
      (model) => {
        expect(thinkingLevelFor(model)).toBeUndefined();
      },
    );
  });

  describe('errors', () => {
    const abortError = () => {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      return error;
    };

    it.each<[string, () => unknown, ProviderFailureKind, number | undefined]>([
      ['401', () => new ApiError({ message: 'RAW-BODY-SECRET', status: 401 }), 'auth', 401],
      ['403', () => new ApiError({ message: 'RAW-BODY-SECRET', status: 403 }), 'auth', 403],
      ['429', () => new ApiError({ message: 'RAW-BODY-SECRET', status: 429 }), 'rate_limit', 429],
      ['503', () => new ApiError({ message: 'RAW-BODY-SECRET', status: 503 }), 'server', 503],
      ['400', () => new ApiError({ message: 'RAW-BODY-SECRET', status: 400 }), 'bad_request', 400],
      ['abort', abortError, 'aborted', undefined],
      ['fetch failure', () => new TypeError('fetch failed'), 'network', undefined],
      ['unexpected error', () => new RangeError('RAW-BODY-SECRET'), 'unknown', undefined],
    ])(
      'maps %s (thrown before streaming) to a secret-free ProviderError',
      async (_n, make, kind, status) => {
        sdk.failBeforeStream = make();

        const error = await collect(geminiProvider.stream(REQUEST)).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ProviderError);
        expect(error).toMatchObject({ provider: 'gemini', kind, status });
        expect((error as Error).message).not.toContain('RAW-BODY-SECRET');
      },
    );

    it('maps errors thrown while streaming the same way', async () => {
      sdk.nextChunks = [chunk('partial')];
      sdk.failWith = new ApiError({ message: 'RAW-BODY-SECRET', status: 500 });

      const error = await collect(geminiProvider.stream(REQUEST)).catch((e: unknown) => e);

      expect(error).toMatchObject({ kind: 'server', status: 500 });
    });
  });
});
