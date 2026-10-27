import 'server-only';
import type { ProviderId } from '@/lib/ai/types';
import { getCollections } from '@/lib/db/collections';
import { getUsageEnv, type UsageEnv } from '@/lib/env';

/** Counters outlive their day by one more, then the TTL index drops them. */
const COUNTER_TTL_MS = 2 * 24 * 60 * 60 * 1000;

/** Chat providers that cost money, with the cap that bounds them. Free ones are not counted. */
const PAID_PROVIDER_CAPS: Partial<Record<ProviderId, keyof UsageEnv>> = {
  anthropic: 'anthropicTotal',
};

export type QuotaResult = { ok: true } | { ok: false; retryAfterSeconds: number };

interface Counter {
  scope: string;
  limit: number;
}

/** `YYYY-MM-DD` of the UTC day; every counter resets at UTC midnight. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Seconds until the next UTC day starts (at least 1), for `Retry-After`. */
export function retryAfterSeconds(now: Date = new Date()): number {
  const nextDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((nextDay - now.getTime()) / 1000));
}

/**
 * Adds `amount` to each counter in turn and stops at the first one that went
 * over its limit, so a user who is out of quota no longer eats into the totals.
 * A request that lands exactly on the limit is still allowed.
 */
async function consume(
  counters: readonly Counter[],
  amount: number,
  now: Date,
): Promise<QuotaResult> {
  const { usage } = await getCollections();
  const day = utcDay(now);
  const expiresAt = new Date(now.getTime() + COUNTER_TTL_MS);
  for (const { scope, limit } of counters) {
    const counter = await usage.findOneAndUpdate(
      { _id: `${scope}:${day}` },
      { $inc: { count: amount }, $setOnInsert: { expiresAt } },
      { upsert: true, returnDocument: 'after' },
    );
    if ((counter?.count ?? amount) > limit) {
      return { ok: false, retryAfterSeconds: retryAfterSeconds(now) };
    }
  }
  return { ok: true };
}

/** Counts one chat message against the user's and the site's daily caps. */
export function consumeChatMessage(userId: string, now: Date = new Date()): Promise<QuotaResult> {
  const limits = getUsageEnv();
  return consume(
    [
      { scope: `chat:user:${userId}`, limit: limits.chatPerUser },
      { scope: 'chat:total', limit: limits.chatTotal },
    ],
    1,
    now,
  );
}

/** Counts the characters of one speech request against the user's and the site's daily caps. */
export function consumeSpeechChars(
  userId: string,
  chars: number,
  now: Date = new Date(),
): Promise<QuotaResult> {
  const limits = getUsageEnv();
  return consume(
    [
      { scope: `tts:user:${userId}`, limit: limits.ttsCharsPerUser },
      { scope: 'tts:total', limit: limits.ttsCharsTotal },
    ],
    chars,
    now,
  );
}

/** Paid providers that have used up today's cap and must be left out of the chain. */
export async function cappedProviders(now: Date = new Date()): Promise<ProviderId[]> {
  const paid = Object.entries(PAID_PROVIDER_CAPS) as [ProviderId, keyof UsageEnv][];
  if (paid.length === 0) return [];
  const { usage } = await getCollections();
  const day = utcDay(now);
  const counters = await usage
    .find({ _id: { $in: paid.map(([provider]) => `provider:${provider}:${day}`) } })
    .toArray();
  const used = new Map(counters.map((counter) => [counter._id, counter.count]));
  const limits = getUsageEnv();
  return paid
    .filter(([provider, cap]) => (used.get(`provider:${provider}:${day}`) ?? 0) >= limits[cap])
    .map(([provider]) => provider);
}

/** Records one reply from a paid provider; free providers are not counted. */
export async function recordProviderUse(
  provider: ProviderId,
  now: Date = new Date(),
): Promise<void> {
  if (!PAID_PROVIDER_CAPS[provider]) return;
  const { usage } = await getCollections();
  await usage.updateOne(
    { _id: `provider:${provider}:${utcDay(now)}` },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(now.getTime() + COUNTER_TTL_MS) } },
    { upsert: true },
  );
}
