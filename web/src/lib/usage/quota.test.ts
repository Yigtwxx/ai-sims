// @vitest-environment node
import net from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UsageDoc } from '@/lib/db/collections';
import { retryAfterSeconds, utcDay } from './quota';

const TEST_URI = 'mongodb://127.0.0.1:27018/ai-sims-test-usage';

function isReachable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 500 });
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('timeout', () => (socket.destroy(), resolve(false)));
    socket.once('error', () => resolve(false));
  });
}

const reachable = await isReachable('127.0.0.1', 27018);

describe('day boundaries', () => {
  it('keys counters by the UTC day', () => {
    expect(utcDay(new Date('2026-10-27T23:59:59.999Z'))).toBe('2026-10-27');
    expect(utcDay(new Date('2026-10-28T00:00:00.000Z'))).toBe('2026-10-28');
  });

  it('retries at the next UTC midnight, never sooner than a second', () => {
    expect(retryAfterSeconds(new Date('2026-10-27T23:00:00Z'))).toBe(3600);
    expect(retryAfterSeconds(new Date('2026-10-27T00:00:00Z'))).toBe(86_400);
    expect(retryAfterSeconds(new Date('2026-10-27T23:59:59.900Z'))).toBe(1);
  });
});

describe.skipIf(!reachable)('daily quotas (local MongoDB)', () => {
  let quota: typeof import('./quota');
  let mongo: typeof import('@/lib/db/mongo');

  const NOW = new Date('2026-10-27T12:00:00Z');
  const TOMORROW = new Date('2026-10-28T00:00:01Z');

  beforeAll(async () => {
    vi.stubEnv('MONGODB_URI', TEST_URI);
    mongo = await import('@/lib/db/mongo');
    quota = await import('./quota');
    await mongo.getDb().dropDatabase();
  });

  beforeEach(async () => {
    vi.stubEnv('CHAT_DAILY_LIMIT_PER_USER', '2');
    vi.stubEnv('CHAT_DAILY_LIMIT_TOTAL', '3');
    vi.stubEnv('TTS_DAILY_CHARS_PER_USER', '100');
    vi.stubEnv('TTS_DAILY_CHARS_TOTAL', '1000');
    vi.stubEnv('ANTHROPIC_DAILY_LIMIT', '2');
    await mongo.getDb().collection('usage').deleteMany({});
  });

  afterAll(async () => {
    await mongo.getDb().dropDatabase();
    await mongo.getMongoClient().close();
    vi.unstubAllEnvs();
  });

  it('allows messages up to the per-user limit, then refuses until the next day', async () => {
    expect(await quota.consumeChatMessage('a', NOW)).toEqual({ ok: true });
    expect(await quota.consumeChatMessage('a', NOW)).toEqual({ ok: true });
    expect(await quota.consumeChatMessage('a', NOW)).toEqual({
      ok: false,
      retryAfterSeconds: 12 * 3600,
    });
    expect(await quota.consumeChatMessage('a', TOMORROW)).toEqual({ ok: true });
  });

  it('stops everyone at the site-wide total', async () => {
    await quota.consumeChatMessage('a', NOW);
    await quota.consumeChatMessage('b', NOW);
    expect(await quota.consumeChatMessage('c', NOW)).toEqual({ ok: true });
    expect((await quota.consumeChatMessage('d', NOW)).ok).toBe(false);
  });

  it('does not count a refused user against the total', async () => {
    await quota.consumeChatMessage('a', NOW);
    await quota.consumeChatMessage('a', NOW);
    for (let i = 0; i < 5; i += 1) await quota.consumeChatMessage('a', NOW);
    expect(await quota.consumeChatMessage('b', NOW)).toEqual({ ok: true });
  });

  it('counts speech by characters', async () => {
    expect((await quota.consumeSpeechChars('a', 60, NOW)).ok).toBe(true);
    expect((await quota.consumeSpeechChars('a', 40, NOW)).ok).toBe(true);
    expect((await quota.consumeSpeechChars('a', 1, NOW)).ok).toBe(false);
    expect((await quota.consumeSpeechChars('b', 100, NOW)).ok).toBe(true);
  });

  it('caps paid providers and ignores free ones', async () => {
    expect(await quota.cappedProviders(NOW)).toEqual([]);
    await quota.recordProviderUse('groq', NOW);
    await quota.recordProviderUse('anthropic', NOW);
    expect(await quota.cappedProviders(NOW)).toEqual([]);
    await quota.recordProviderUse('anthropic', NOW);
    expect(await quota.cappedProviders(NOW)).toEqual(['anthropic']);
    expect(await quota.cappedProviders(TOMORROW)).toEqual([]);
    expect(
      await mongo
        .getDb()
        .collection('usage')
        .countDocuments({ _id: /^provider:groq/ }),
    ).toBe(0);
  });

  it('expires counters through a TTL index', async () => {
    await quota.consumeChatMessage('a', NOW);
    const counter = await mongo
      .getDb()
      .collection<UsageDoc>('usage')
      .findOne({ _id: 'chat:user:a:2026-10-27' });
    expect(counter?.expiresAt).toEqual(new Date('2026-10-29T12:00:00Z'));
    const indexes = await mongo.getDb().collection('usage').indexes();
    expect(indexes.find((index) => index.name === 'expiresAt_ttl')?.expireAfterSeconds).toBe(0);
  });
});
