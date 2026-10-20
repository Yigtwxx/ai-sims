'use server';

import { requireUserId } from '@/lib/auth/session';
import { CharacterConfigSchema } from '@/lib/character/schema';
import {
  createCharacter,
  InvalidCharacterInputError,
  InvalidThumbnailError,
  saveThumbnail,
  updateCharacter,
} from '@/lib/characters/repository';

export type SaveCharacterResult =
  { ok: true; id: string } | { ok: false; error: 'invalid' | 'not_found' | 'failed' };

export interface SaveCharacterInput {
  /** Existing character id when editing; omitted to create. */
  id?: string;
  name: string;
  config: unknown;
  status: 'draft' | 'finalized';
}

/** Create or update the signed-in user's character (validated in the repository). */
export async function saveCharacterAction(input: SaveCharacterInput): Promise<SaveCharacterResult> {
  // Server actions are public endpoints: always re-verify the session.
  const userId = await requireUserId();
  const parsed = CharacterConfigSchema.safeParse(input.config);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const config = parsed.data;
  try {
    if (input.id) {
      const updated = await updateCharacter(userId, input.id, {
        name: input.name,
        config,
        status: input.status,
      });
      return updated ? { ok: true, id: updated.id } : { ok: false, error: 'not_found' };
    }
    const created = await createCharacter(userId, {
      name: input.name,
      config,
      status: input.status,
    });
    return { ok: true, id: created.id };
  } catch (error) {
    if (error instanceof InvalidCharacterInputError) return { ok: false, error: 'invalid' };
    return { ok: false, error: 'failed' };
  }
}

const DATA_URL_PREFIX = 'data:image/webp;base64,';

/** Store a WebP snapshot of the stage as the character's thumbnail. */
export async function saveThumbnailAction(id: string, dataUrl: string): Promise<boolean> {
  const userId = await requireUserId();
  if (!dataUrl.startsWith(DATA_URL_PREFIX)) return false;
  try {
    const bytes = Buffer.from(dataUrl.slice(DATA_URL_PREFIX.length), 'base64');
    return await saveThumbnail(userId, id, new Uint8Array(bytes));
  } catch (error) {
    if (error instanceof InvalidThumbnailError) return false;
    throw error;
  }
}
