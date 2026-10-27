// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProviderError } from '@/lib/ai/errors';
import type { ChatProvider, ChatRequest, ProviderId } from '@/lib/ai/types';

// Session, repository and providers are replaced by fakes: no database, no network.
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getCharacter: vi.fn(),
  hasConfiguredProvider: vi.fn(),
  getOrderedProviders: vi.fn(),
  consumeChatMessage: vi.fn(),
  cappedProviders: vi.fn(),
  recordProviderUse: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({ getSession: mocks.getSession }));
vi.mock('@/lib/characters/repository', () => ({ getCharacter: mocks.getCharacter }));
vi.mock('@/lib/ai/providers', () => ({
  hasConfiguredProvider: mocks.hasConfiguredProvider,
  getOrderedProviders: mocks.getOrderedProviders,
}));
vi.mock('@/lib/usage/quota', () => ({
  consumeChatMessage: mocks.consumeChatMessage,
  cappedProviders: mocks.cappedProviders,
  recordProviderUse: mocks.recordProviderUse,
  retryAfterSeconds: () => 3600,
}));

const { POST } = await import('./route');

const VALID_BODY = { locale: 'tr', messages: [{ role: 'user', content: 'Merhaba' }] };

function post(body: unknown, init: RequestInit = {}): Request {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  });
}

function provider(
  id: ProviderId,
  script: (request: ChatRequest) => AsyncGenerator<string>,
): ChatProvider & { stream: ReturnType<typeof vi.fn> } {
  const stream = vi.fn(script);
  return { id, isConfigured: () => true, stream };
}

async function* chunks(...values: string[]): AsyncGenerator<string> {
  for (const value of values) yield value;
}

beforeEach(() => {
  mocks.getSession.mockResolvedValue({ id: 'user-1', isAnonymous: true });
  mocks.getCharacter.mockResolvedValue(null);
  mocks.hasConfiguredProvider.mockReturnValue(true);
  mocks.getOrderedProviders.mockReturnValue([provider('anthropic', () => chunks('Selam!'))]);
  mocks.consumeChatMessage.mockResolvedValue({ ok: true });
  mocks.cappedProviders.mockResolvedValue([]);
  mocks.recordProviderUse.mockResolvedValue(undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('POST /api/chat', () => {
  describe('guards', () => {
    it('answers 401 without a session and touches nothing else', async () => {
      mocks.getSession.mockResolvedValue(null);

      const response = await POST(post(VALID_BODY));

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'unauthenticated' });
      expect(mocks.hasConfiguredProvider).not.toHaveBeenCalled();
    });

    it('answers 503 ai_not_configured when no provider has a key, before reading the body', async () => {
      mocks.hasConfiguredProvider.mockReturnValue(false);

      const response = await POST(post('not even json'));

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'ai_not_configured' });
    });
  });

  describe('validation', () => {
    it('answers 400 for a body that is not JSON', async () => {
      const response = await POST(post('{nope'));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'invalid_request' });
    });

    it('answers 413 for an oversized body', async () => {
      const response = await POST(post(VALID_BODY, { headers: { 'content-length': '9999999' } }));
      expect(response.status).toBe(413);
    });

    it.each([
      ['no messages', { locale: 'tr', messages: [] }],
      ['an unknown locale', { ...VALID_BODY, locale: 'de' }],
      ['an unknown role', { ...VALID_BODY, messages: [{ role: 'system', content: 'x' }] }],
      [
        'too many messages',
        {
          ...VALID_BODY,
          messages: Array.from({ length: 25 }, () => ({ role: 'user', content: 'x' })),
        },
      ],
      [
        'a message over 2000 characters',
        { ...VALID_BODY, messages: [{ role: 'user', content: 'a'.repeat(2001) }] },
      ],
    ])('answers 400 with issues for %s', async (_name, body) => {
      const response = await POST(post(body));
      const json = (await response.json()) as { error: string; issues: unknown[] };
      expect(response.status).toBe(400);
      expect(json.error).toBe('invalid_request');
      expect(json.issues.length).toBeGreaterThan(0);
    });

    it('answers 400 when the conversation does not end with a user message', async () => {
      const response = await POST(
        post({
          locale: 'en',
          messages: [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'hello' },
          ],
        }),
      );
      expect(response.status).toBe(400);
    });
  });

  describe('character persona', () => {
    it('loads the character scoped to the signed-in user and uses it in the system prompt', async () => {
      mocks.getCharacter.mockResolvedValue({ name: 'Mira', base: 'female', style: 'realistic' });
      const p = provider('anthropic', () => chunks('Merhaba!'));
      mocks.getOrderedProviders.mockReturnValue([p]);

      const response = await POST(post({ ...VALID_BODY, characterId: 'char-1' }));

      expect(response.status).toBe(200);
      expect(mocks.getCharacter).toHaveBeenCalledWith('user-1', 'char-1');
      const received = p.stream.mock.calls[0]![0] as ChatRequest;
      expect(received.system).toContain('You are Mira');
      expect(received.system).toContain('female photorealistic');
    });

    it('answers 404 for a character that is missing or belongs to someone else', async () => {
      mocks.getCharacter.mockResolvedValue(null);
      const response = await POST(post({ ...VALID_BODY, characterId: 'someone-elses' }));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'character_not_found' });
    });

    it('does not look anything up without a characterId', async () => {
      await POST(post(VALID_BODY));
      expect(mocks.getCharacter).not.toHaveBeenCalled();
    });
  });

  describe('streaming', () => {
    it('streams plain UTF-8 text and names the provider in X-AI-Provider', async () => {
      mocks.getOrderedProviders.mockReturnValue([
        provider('anthropic', () => chunks('Mer', 'haba, ', 'dünya ğüşiöç')),
      ]);

      const response = await POST(post(VALID_BODY));

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      expect(response.headers.get('x-ai-provider')).toBe('anthropic');
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(await response.text()).toBe('Merhaba, dünya ğüşiöç');
    });

    it('sends the cleaned conversation to the provider', async () => {
      const p = provider('anthropic', () => chunks('ok'));
      mocks.getOrderedProviders.mockReturnValue([p]);

      await POST(
        post({
          locale: 'tr',
          messages: [
            { role: 'assistant', content: 'leftover' },
            { role: 'user', content: 'bir' },
            { role: 'user', content: 'iki' },
          ],
        }),
      );

      const received = p.stream.mock.calls[0]![0] as ChatRequest;
      expect(received.messages).toEqual([{ role: 'user', content: 'bir\niki' }]);
    });

    it('falls back to the next provider before the first token and reports who answered', async () => {
      mocks.getOrderedProviders.mockReturnValue([
        provider('anthropic', async function* () {
          yield* [];
          throw new ProviderError('anthropic', 'rate_limit', 429);
        }),
        provider('gemini', () => chunks('Gemini cevabı')),
      ]);

      const response = await POST(post(VALID_BODY));

      expect(response.status).toBe(200);
      expect(response.headers.get('x-ai-provider')).toBe('gemini');
      expect(await response.text()).toBe('Gemini cevabı');
    });

    it('answers 502 ai_unavailable when every provider fails, without leaking provider details', async () => {
      mocks.getOrderedProviders.mockReturnValue([
        provider('anthropic', async function* () {
          yield* [];
          throw new Error('Bearer sk-ant-SECRET raw body');
        }),
        provider('groq', async function* () {
          yield* [];
          throw new ProviderError('groq', 'auth', 401);
        }),
      ]);

      const response = await POST(post(VALID_BODY));
      const text = await response.text();

      expect(response.status).toBe(502);
      expect(JSON.parse(text)).toEqual({ error: 'ai_unavailable' });
      expect(text).not.toContain('SECRET');
    });

    it('errors the stream, instead of switching providers, when a failure comes after the first token', async () => {
      const second = provider('gemini', () => chunks('must not be used'));
      mocks.getOrderedProviders.mockReturnValue([
        provider('anthropic', async function* () {
          yield 'Merha';
          throw new Error('Bearer sk-ant-SECRET raw body');
        }),
        second,
      ]);

      const response = await POST(post(VALID_BODY));
      expect(response.status).toBe(200);
      expect(response.headers.get('x-ai-provider')).toBe('anthropic');

      const reader = response.body!.getReader();
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toBe('Merha');
      await expect(reader.read()).rejects.toThrow('The reply was interrupted');

      expect(second.stream).not.toHaveBeenCalled();
      expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('SECRET');
    });
  });
});

describe('POST /api/chat daily quota', () => {
  it('answers 429 with Retry-After once the user is out of messages', async () => {
    const anthropic = provider('anthropic', () => chunks('Selam!'));
    mocks.getOrderedProviders.mockReturnValue([anthropic]);
    mocks.consumeChatMessage.mockResolvedValue({ ok: false, retryAfterSeconds: 120 });

    const response = await POST(post(VALID_BODY));

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('120');
    expect(await response.json()).toEqual({ error: 'rate_limited' });
    expect(mocks.consumeChatMessage).toHaveBeenCalledWith('user-1');
    expect(anthropic.stream).not.toHaveBeenCalled();
  });

  it('does not count a request that fails validation', async () => {
    const response = await POST(post({ locale: 'tr', messages: [] }));

    expect(response.status).toBe(400);
    expect(mocks.consumeChatMessage).not.toHaveBeenCalled();
  });

  it('leaves a capped paid provider out of the chain', async () => {
    const anthropic = provider('anthropic', () => chunks('pahalı'));
    const gemini = provider('gemini', () => chunks('Merhaba!'));
    mocks.getOrderedProviders.mockReturnValue([anthropic, gemini]);
    mocks.cappedProviders.mockResolvedValue(['anthropic']);

    const response = await POST(post(VALID_BODY));

    expect(response.status).toBe(200);
    expect(response.headers.get('X-AI-Provider')).toBe('gemini');
    expect(await response.text()).toBe('Merhaba!');
    expect(anthropic.stream).not.toHaveBeenCalled();
  });

  it('answers 429 when only capped providers are left', async () => {
    mocks.cappedProviders.mockResolvedValue(['anthropic']);

    const response = await POST(post(VALID_BODY));

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('3600');
  });

  it('records the provider that answered', async () => {
    const response = await POST(post(VALID_BODY));
    await response.text();

    expect(mocks.recordProviderUse).toHaveBeenCalledWith('anthropic');
  });

  it('still streams the reply when recording fails', async () => {
    mocks.recordProviderUse.mockRejectedValue(new Error('db down'));

    const response = await POST(post(VALID_BODY));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Selam!');
  });
});
