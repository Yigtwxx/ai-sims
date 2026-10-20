import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CharacterConfigSchema,
  type CharacterBase,
  type CharacterConfig,
} from '@/lib/character/schema';
import type { CharacterRow, Database, Json } from '@/lib/supabase/database.types';

export type CharacterStatus = CharacterRow['status'];

export type Character = {
  id: string;
  userId: string;
  name: string;
  base: CharacterBase;
  config: CharacterConfig;
  schemaVersion: number;
  status: CharacterStatus;
  thumbnailPath: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NewCharacter = {
  name: string;
  /** `base` and `schema_version` columns are derived from this. */
  config: CharacterConfig;
  status?: CharacterStatus;
};

export type CharacterPatch = {
  name?: string;
  config?: CharacterConfig;
  status?: CharacterStatus;
  thumbnailPath?: string | null;
};

type Client = SupabaseClient<Database>;

/** Thrown for database failures. Carries only the PostgREST code, never the raw response. */
export class CharacterRepositoryError extends Error {
  constructor(
    readonly operation: string,
    readonly code?: string,
  ) {
    super(`Character repository: ${operation} failed${code ? ` (${code})` : ''}`);
    this.name = 'CharacterRepositoryError';
  }
}

/** Thrown when a stored config no longer satisfies the current schema. */
export class InvalidCharacterConfigError extends Error {
  constructor(readonly characterId: string) {
    super(`Character ${characterId} has an invalid config`);
    this.name = 'InvalidCharacterConfigError';
  }
}

function toCharacter(row: CharacterRow): Character {
  const parsed = CharacterConfigSchema.safeParse(row.config);
  if (!parsed.success) throw new InvalidCharacterConfigError(row.id);

  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    base: row.base,
    config: parsed.data,
    schemaVersion: row.schema_version,
    status: row.status,
    thumbnailPath: row.thumbnail_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// The zod output is JSON-compatible; Json's index signature just can't express that.
function configToJson(config: CharacterConfig): Json {
  return CharacterConfigSchema.parse(config) as unknown as Json;
}

/** Lists the signed-in user's characters, newest first (RLS scopes the rows). */
export async function listCharacters(client: Client): Promise<Character[]> {
  const { data, error } = await client
    .from('characters')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) throw new CharacterRepositoryError('list', error.code);
  return data.map(toCharacter);
}

/** Returns null when the character does not exist or belongs to someone else. */
export async function getCharacter(client: Client, id: string): Promise<Character | null> {
  const { data, error } = await client.from('characters').select('*').eq('id', id).maybeSingle();
  if (error) throw new CharacterRepositoryError('get', error.code);
  return data ? toCharacter(data) : null;
}

export async function createCharacter(client: Client, input: NewCharacter): Promise<Character> {
  const { data, error } = await client
    .from('characters')
    .insert({
      name: input.name,
      base: input.config.base,
      config: configToJson(input.config),
      schema_version: input.config.schemaVersion,
      status: input.status ?? 'draft',
    })
    .select('*')
    .single();
  if (error) throw new CharacterRepositoryError('create', error.code);
  return toCharacter(data);
}

export async function updateCharacter(
  client: Client,
  id: string,
  patch: CharacterPatch,
): Promise<Character> {
  const update: Database['public']['Tables']['characters']['Update'] = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.thumbnailPath !== undefined) update.thumbnail_path = patch.thumbnailPath;
  if (patch.config !== undefined) {
    update.config = configToJson(patch.config);
    update.base = patch.config.base;
    update.schema_version = patch.config.schemaVersion;
  }

  const { data, error } = await client
    .from('characters')
    .update(update)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new CharacterRepositoryError('update', error.code);
  return toCharacter(data);
}

export async function deleteCharacter(client: Client, id: string): Promise<void> {
  const { error } = await client.from('characters').delete().eq('id', id);
  if (error) throw new CharacterRepositoryError('delete', error.code);
}
