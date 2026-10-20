// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connection: vi.fn(async () => undefined),
  getProviderConfiguration: vi.fn(),
  isDatabaseReachable: vi.fn(),
  getAuthEnv: vi.fn(),
  isAzureSpeechConfigured: vi.fn(),
}));

vi.mock('next/server', () => ({ connection: mocks.connection }));
vi.mock('@/lib/ai/providers', () => ({ getProviderConfiguration: mocks.getProviderConfiguration }));
vi.mock('@/lib/db/health', () => ({ isDatabaseReachable: mocks.isDatabaseReachable }));
vi.mock('@/lib/env', () => ({
  getAuthEnv: mocks.getAuthEnv,
  isAzureSpeechConfigured: mocks.isAzureSpeechConfigured,
}));

const { GET } = await import('./route');

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development');
  mocks.getProviderConfiguration.mockReturnValue({ anthropic: false, gemini: false, groq: false });
  mocks.isDatabaseReachable.mockResolvedValue(false);
  mocks.getAuthEnv.mockReturnValue(null);
  mocks.isAzureSpeechConfigured.mockReturnValue(false);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('GET /api/health', () => {
  it('reports everything as false when nothing is configured', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      db: false,
      auth: false,
      ai: { anthropic: false, gemini: false, groq: false },
      tts: { azure: false },
    });
  });

  it('reports configured services as true', async () => {
    mocks.isDatabaseReachable.mockResolvedValue(true);
    mocks.getAuthEnv.mockReturnValue({ secret: 'x'.repeat(40), url: 'http://localhost:3000' });
    mocks.getProviderConfiguration.mockReturnValue({ anthropic: true, gemini: false, groq: true });
    mocks.isAzureSpeechConfigured.mockReturnValue(true);

    const json = await (await GET()).json();

    expect(json).toEqual({
      db: true,
      auth: true,
      ai: { anthropic: true, gemini: false, groq: true },
      tts: { azure: true },
    });
  });

  it('only ever returns booleans, never a value', async () => {
    mocks.getAuthEnv.mockReturnValue({
      secret: 'super-secret-value-that-is-long-enough!!',
      url: 'http://localhost:3000',
    });
    mocks.getProviderConfiguration.mockReturnValue({ anthropic: true, gemini: true, groq: true });

    const text = await (await GET()).text();

    expect(text).not.toContain('super-secret');
    expect(text).not.toContain('localhost');
    const flatten = (value: unknown): unknown[] =>
      value !== null && typeof value === 'object' ? Object.values(value).flatMap(flatten) : [value];
    for (const leaf of flatten(JSON.parse(text))) expect(typeof leaf).toBe('boolean');
  });

  it('is never cached', async () => {
    expect((await GET()).headers.get('cache-control')).toBe('no-store');
  });

  it('waits for a real request so the answer is never baked in at build time', async () => {
    await GET();
    expect(mocks.connection).toHaveBeenCalledTimes(1);
  });

  it('answers 404 in production without checking anything', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const response = await GET();

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
    expect(mocks.isDatabaseReachable).not.toHaveBeenCalled();
    expect(mocks.getProviderConfiguration).not.toHaveBeenCalled();
  });
});
