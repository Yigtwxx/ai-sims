import 'server-only';
import type { Binary, Collection, ObjectId } from 'mongodb';
import type { CharacterBase, CharacterStyle } from '@/lib/character/schema';
import { getDb } from './mongo';

export type CharacterStatus = 'draft' | 'finalized';

export type CharacterDoc = {
  _id: ObjectId;
  /** Better Auth user id. Every query must filter on it (replaces Postgres RLS). */
  userId: string;
  name: string;
  /** v1 documents still say 'anime' until they are saved again. */
  style: CharacterStyle | 'anime';
  base: CharacterBase;
  /** Any schema version; read through migrateConfig(). */
  config: unknown;
  schemaVersion: number;
  status: CharacterStatus;
  hasThumbnail: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type ThumbnailDoc = {
  /** Same ObjectId as the owning character. */
  _id: ObjectId;
  userId: string;
  contentType: 'image/webp';
  data: Binary;
  updatedAt: Date;
};

/** A daily usage counter (`<scope>:<YYYY-MM-DD>`), removed by a TTL index once expired. */
export type UsageDoc = {
  _id: string;
  count: number;
  expiresAt: Date;
};

export type Collections = {
  characters: Collection<CharacterDoc>;
  thumbnails: Collection<ThumbnailDoc>;
  usage: Collection<UsageDoc>;
};

// One promise per process; reset on failure so the next call retries.
const globalForIndexes = globalThis as typeof globalThis & {
  __mongoIndexesReady?: Promise<void>;
};

/** Creates the indexes the app relies on. Idempotent: createIndex is a no-op when they exist. */
export async function ensureIndexes(): Promise<void> {
  const db = getDb();
  await db
    .collection<CharacterDoc>('characters')
    .createIndex({ userId: 1, updatedAt: -1 }, { name: 'userId_1_updatedAt_-1' });
  // thumbnails are keyed by _id, which MongoDB indexes by default.
  await db
    .collection<UsageDoc>('usage')
    .createIndex({ expiresAt: 1 }, { name: 'expiresAt_ttl', expireAfterSeconds: 0 });
}

/** Returns typed collections, ensuring indexes once per process. */
export async function getCollections(): Promise<Collections> {
  globalForIndexes.__mongoIndexesReady ??= ensureIndexes().catch((error: unknown) => {
    globalForIndexes.__mongoIndexesReady = undefined;
    throw error;
  });
  await globalForIndexes.__mongoIndexesReady;

  const db = getDb();
  return {
    characters: db.collection<CharacterDoc>('characters'),
    thumbnails: db.collection<ThumbnailDoc>('thumbnails'),
    usage: db.collection<UsageDoc>('usage'),
  };
}
