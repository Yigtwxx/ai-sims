import 'server-only';
import { Binary, ObjectId } from 'mongodb';
import { z } from 'zod';
import {
  CharacterConfigSchema,
  type CharacterBase,
  type CharacterConfig,
  type CharacterStyle,
} from '@/lib/character/schema';
import { getCollections, type CharacterDoc, type CharacterStatus } from '@/lib/db/collections';

export type { CharacterStatus };

/**
 * Data access layer for characters.
 *
 * Authorization rule (replaces Postgres RLS): EVERY query filters on `userId`.
 * Callers pass the id from `requireUserId()`, never a value from the client.
 */

export const MAX_THUMBNAIL_BYTES = 512 * 1024;

const NameSchema = z.string().trim().min(1).max(40);
const StatusSchema = z.enum(['draft', 'finalized']);

export type Character = {
  id: string;
  userId: string;
  name: string;
  style: CharacterStyle;
  base: CharacterBase;
  config: CharacterConfig;
  schemaVersion: number;
  status: CharacterStatus;
  hasThumbnail: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type NewCharacter = {
  name: string;
  /** `style`, `base` and `schemaVersion` are derived from this. */
  config: CharacterConfig;
  status?: CharacterStatus;
};

export type CharacterPatch = {
  name?: string;
  config?: CharacterConfig;
  status?: CharacterStatus;
};

/** Thrown when input (name, status, config) fails validation. */
export class InvalidCharacterInputError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid character input: ${issues.join('; ')}`);
    this.name = 'InvalidCharacterInputError';
  }
}

/** Thrown when a stored config no longer satisfies the current schema. */
export class InvalidCharacterConfigError extends Error {
  constructor(readonly characterId: string) {
    super(`Character ${characterId} has an invalid config`);
    this.name = 'InvalidCharacterConfigError';
  }
}

export class InvalidThumbnailError extends Error {
  constructor(readonly reason: 'too_large' | 'not_webp' | 'empty') {
    super(`Invalid thumbnail: ${reason}`);
    this.name = 'InvalidThumbnailError';
  }
}

function parseOrThrow<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new InvalidCharacterInputError(
      result.error.issues.map((issue) => `${issue.path.join('.') || 'value'}: ${issue.message}`),
    );
  }
  return result.data;
}

const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;

/** Returns null for malformed ids so they behave like "not found". */
function toObjectId(id: string): ObjectId | null {
  return OBJECT_ID_PATTERN.test(id) ? new ObjectId(id) : null;
}

function toCharacter(doc: CharacterDoc): Character {
  const parsed = CharacterConfigSchema.safeParse(doc.config);
  if (!parsed.success) throw new InvalidCharacterConfigError(doc._id.toHexString());

  return {
    id: doc._id.toHexString(),
    userId: doc.userId,
    name: doc.name,
    style: parsed.data.style,
    base: parsed.data.base,
    config: parsed.data,
    schemaVersion: parsed.data.schemaVersion,
    status: doc.status,
    hasThumbnail: doc.hasThumbnail,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/** Lists the user's characters, most recently updated first. */
export async function listCharacters(userId: string): Promise<Character[]> {
  const { characters } = await getCollections();
  const docs = await characters.find({ userId }).sort({ updatedAt: -1 }).toArray();
  return docs.map(toCharacter);
}

/** Returns null when the character does not exist or belongs to someone else. */
export async function getCharacter(userId: string, id: string): Promise<Character | null> {
  const _id = toObjectId(id);
  if (!_id) return null;
  const { characters } = await getCollections();
  const doc = await characters.findOne({ _id, userId });
  return doc ? toCharacter(doc) : null;
}

export async function createCharacter(userId: string, input: NewCharacter): Promise<Character> {
  const name = parseOrThrow(NameSchema, input.name);
  const status = parseOrThrow(StatusSchema, input.status ?? 'draft');
  const config = parseOrThrow(CharacterConfigSchema, input.config);

  const now = new Date();
  const doc: CharacterDoc = {
    _id: new ObjectId(),
    userId,
    name,
    style: config.style,
    base: config.base,
    config,
    schemaVersion: config.schemaVersion,
    status,
    hasThumbnail: false,
    createdAt: now,
    updatedAt: now,
  };

  const { characters } = await getCollections();
  await characters.insertOne(doc);
  return toCharacter(doc);
}

/** Returns null when the character does not exist or belongs to someone else. */
export async function updateCharacter(
  userId: string,
  id: string,
  patch: CharacterPatch,
): Promise<Character | null> {
  const _id = toObjectId(id);
  if (!_id) return null;

  const set: Partial<CharacterDoc> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = parseOrThrow(NameSchema, patch.name);
  if (patch.status !== undefined) set.status = parseOrThrow(StatusSchema, patch.status);
  if (patch.config !== undefined) {
    const config = parseOrThrow(CharacterConfigSchema, patch.config);
    set.config = config;
    set.style = config.style;
    set.base = config.base;
    set.schemaVersion = config.schemaVersion;
  }

  const { characters } = await getCollections();
  const doc = await characters.findOneAndUpdate(
    { _id, userId },
    { $set: set },
    { returnDocument: 'after' },
  );
  return doc ? toCharacter(doc) : null;
}

/** Deletes the character and its thumbnail. Returns false when nothing was deleted. */
export async function deleteCharacter(userId: string, id: string): Promise<boolean> {
  const _id = toObjectId(id);
  if (!_id) return false;

  const { characters, thumbnails } = await getCollections();
  const { deletedCount } = await characters.deleteOne({ _id, userId });
  if (deletedCount === 0) return false;
  await thumbnails.deleteOne({ _id, userId });
  return true;
}

/** RIFF....WEBP container signature. */
function isWebp(data: Uint8Array): boolean {
  if (data.length < 12) return false;
  const ascii = (start: number, end: number) => String.fromCharCode(...data.subarray(start, end));
  return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
}

/**
 * Stores or replaces the character's WebP thumbnail (max 512 KB).
 * Returns false when the character does not exist or belongs to someone else.
 */
export async function saveThumbnail(
  userId: string,
  id: string,
  data: Uint8Array,
): Promise<boolean> {
  if (data.byteLength === 0) throw new InvalidThumbnailError('empty');
  if (data.byteLength > MAX_THUMBNAIL_BYTES) throw new InvalidThumbnailError('too_large');
  if (!isWebp(data)) throw new InvalidThumbnailError('not_webp');

  const _id = toObjectId(id);
  if (!_id) return false;

  const { characters, thumbnails } = await getCollections();
  const now = new Date();
  const owned = await characters.updateOne(
    { _id, userId },
    { $set: { hasThumbnail: true, updatedAt: now } },
  );
  if (owned.matchedCount === 0) return false;

  await thumbnails.replaceOne(
    { _id, userId },
    { userId, contentType: 'image/webp', data: new Binary(data), updatedAt: now },
    { upsert: true },
  );
  return true;
}

export type Thumbnail = { contentType: 'image/webp'; data: Buffer; updatedAt: Date };

/** Returns null when there is no thumbnail or the character belongs to someone else. */
export async function getThumbnail(userId: string, id: string): Promise<Thumbnail | null> {
  const _id = toObjectId(id);
  if (!_id) return null;
  const { thumbnails } = await getCollections();
  const doc = await thumbnails.findOne({ _id, userId });
  if (!doc) return null;
  return {
    contentType: doc.contentType,
    data: Buffer.from(doc.data.buffer.subarray(0, doc.data.length())),
    updatedAt: doc.updatedAt,
  };
}
