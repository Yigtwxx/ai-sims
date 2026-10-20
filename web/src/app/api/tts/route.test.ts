// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TtsError } from '@/lib/tts/errors';

// Session, env and the Azure wrapper are replaced by fakes: no network, no SDK.
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getAzureSpeechEnv: vi.fn(),
  synthesizeSpeech: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({ getSession: mocks.getSession }));
// The route reads the provider chain from getTtsEnv; these tests pin it to Azure only
// (the chain itself is covered in src/lib/tts/providers.test.ts).
vi.mock('@/lib/env', () => ({
  DEFAULT_TTS_VOICES: {
    tr: { female: 'tr-TR-EmelNeural', male: 'tr-TR-AhmetNeural' },
    en: { female: 'en-US-AvaNeural', male: 'en-US-AndrewNeural' },
  },
  getTtsEnv: () => {
    const azure = mocks.getAzureSpeechEnv();
    return { order: azure ? ['azure'] : [], azure, edgeEnabled: false, gemini: null };
  },
}));
vi.mock('@/lib/tts/azure', () => ({ synthesizeSpeech: mocks.synthesizeSpeech }));

const { POST } = await import('./route');

const AZURE_ENV = {
  key: 'azure-test-key',
  region: 'westeurope',
  voices: {
    tr: { female: 'tr-TR-EmelNeural', male: 'tr-TR-AhmetNeural' },
    en: { female: 'en-US-AvaNeural', male: 'en-US-AndrewNeural' },
  },
};

const VALID_BODY = { text: 'Merhaba dünya.', voice: 'female', locale: 'tr' };

const SPEECH = {
  audio: new Uint8Array([1, 2, 3, 4]),
  mime: 'audio/mpeg',
  visemes: [{ time: 0.1, id: 6 }],
  words: [{ time: 0.1, duration: 0.4, text: 'Merhaba' }],
};

function post(body: unknown, init: RequestInit = {}): Request {
  return new Request('http://localhost/api/tts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  });
}

beforeEach(() => {
  mocks.getSession.mockResolvedValue({ id: 'user-1', isAnonymous: true });
  mocks.getAzureSpeechEnv.mockReturnValue(AZURE_ENV);
  mocks.synthesizeSpeech.mockResolvedValue(SPEECH);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('POST /api/tts', () => {
  it('answers 401 without a session', async () => {
    mocks.getSession.mockResolvedValue(null);
    const response = await POST(post(VALID_BODY));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthenticated' });
    expect(mocks.synthesizeSpeech).not.toHaveBeenCalled();
  });

  it('answers 503 tts_not_configured when the key or region is missing, before reading the body', async () => {
    mocks.getAzureSpeechEnv.mockReturnValue(null);
    const response = await POST(post('not json'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'tts_not_configured' });
  });

  it('returns base64 audio with visemes and words', async () => {
    const response = await POST(post(VALID_BODY));
    const json = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(json).toEqual({
      audio: Buffer.from([1, 2, 3, 4]).toString('base64'),
      mime: 'audio/mpeg',
      visemes: [{ time: 0.1, id: 6 }],
      words: [{ time: 0.1, duration: 0.4, text: 'Merhaba' }],
    });
  });

  it.each([
    ['tr', 'female', 'tr-TR-EmelNeural', 'tr-TR'],
    ['tr', 'male', 'tr-TR-AhmetNeural', 'tr-TR'],
    ['en', 'female', 'en-US-AvaNeural', 'en-US'],
    ['en', 'male', 'en-US-AndrewNeural', 'en-US'],
  ])(
    'uses the %s %s voice and the configured key and region',
    async (locale, voice, name, language) => {
      await POST(post({ text: 'Hello there.', voice, locale }));

      expect(mocks.synthesizeSpeech).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Hello there.',
          voice: name,
          language,
          key: 'azure-test-key',
          region: 'westeurope',
        }),
      );
    },
  );

  it('speaks the cleaned text, without emojis or markdown', async () => {
    await POST(post({ ...VALID_BODY, text: '**Merhaba** 😊 dünya!' }));
    expect(mocks.synthesizeSpeech).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Merhaba dünya!' }),
    );
  });

  it('accepts exactly 1200 characters and rejects 1201', async () => {
    expect((await POST(post({ ...VALID_BODY, text: 'a'.repeat(1200) }))).status).toBe(200);
    expect((await POST(post({ ...VALID_BODY, text: 'a'.repeat(1201) }))).status).toBe(400);
  });

  it.each([
    ['empty text', { ...VALID_BODY, text: '' }],
    ['whitespace text', { ...VALID_BODY, text: '   ' }],
    ['an unknown voice', { ...VALID_BODY, voice: 'robot' }],
    ['an unknown locale', { ...VALID_BODY, locale: 'de' }],
    ['a missing field', { text: 'x', voice: 'female' }],
    ['text that is only emojis', { ...VALID_BODY, text: '😊😊' }],
  ])('answers 400 for %s', async (_name, body) => {
    const response = await POST(post(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_request' });
    expect(mocks.synthesizeSpeech).not.toHaveBeenCalled();
  });

  it('answers 400 for a body that is not JSON and 413 for an oversized one', async () => {
    expect((await POST(post('{nope'))).status).toBe(400);
    expect((await POST(post(VALID_BODY, { headers: { 'content-length': '999999' } }))).status).toBe(
      413,
    );
  });

  it('answers 502 tts_unavailable when Azure fails, without leaking the key or details', async () => {
    mocks.synthesizeSpeech.mockRejectedValue(new TtsError('auth'));

    const response = await POST(post(VALID_BODY));
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(JSON.parse(text)).toEqual({ error: 'tts_unavailable' });
    expect(text).not.toContain('azure-test-key');
    // Logged by kind only.
    expect(console.error).toHaveBeenCalledWith('[api/tts] synthesis failed', { kind: 'auth' });
  });

  it('treats an unexpected error as a 502 as well', async () => {
    mocks.synthesizeSpeech.mockRejectedValue(new Error('RAW-DETAILS-SECRET'));
    const response = await POST(post(VALID_BODY));
    expect(response.status).toBe(502);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('SECRET');
  });
});
