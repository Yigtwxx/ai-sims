import { z } from 'zod';

import { migrateConfig } from '@/lib/character/migrations';
import { CURRENT_SCHEMA_VERSION, type CharacterConfig } from '@/lib/character/schema';

/*
 * A new character's work before it has a name lives only in this tab: the
 * server autosave needs a name, so without this a reload would lose it. One
 * draft per tab (sessionStorage), stamped with the config schema version and
 * validated on read. Storage that is missing, full or blocked (private mode,
 * cleared site data) only means there is no local draft; nothing throws.
 */

export const LOCAL_DRAFT_KEY = 'ai-sims.creator.draft';

/** Layout of the stored envelope; bump it when the envelope itself changes. */
const FORMAT = 1;

export interface LocalDraft {
  name: string;
  config: CharacterConfig;
}

export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const EnvelopeSchema = z.object({
  format: z.literal(FORMAT),
  schemaVersion: z.number().int().positive(),
  name: z.string(),
  config: z.unknown(),
});

/** The tab's session storage, or null when the browser withholds it. */
export function draftStorage(): DraftStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function clearLocalDraft(storage: DraftStorage | null = draftStorage()): void {
  try {
    storage?.removeItem(LOCAL_DRAFT_KEY);
  } catch {
    // Blocked storage holds no draft to clear.
  }
}

export function writeLocalDraft(
  draft: LocalDraft,
  storage: DraftStorage | null = draftStorage(),
): void {
  try {
    storage?.setItem(
      LOCAL_DRAFT_KEY,
      JSON.stringify({
        format: FORMAT,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        name: draft.name,
        config: draft.config,
      }),
    );
  } catch {
    // Quota or blocked storage: the draft is simply not kept.
  }
}

/**
 * The stored draft, brought to the current config schema (an older one is
 * migrated), or null. A draft that does not validate, or that a newer app
 * version wrote, is dropped so it cannot fail again on the next reload.
 */
export function readLocalDraft(storage: DraftStorage | null = draftStorage()): LocalDraft | null {
  let raw: string | null;
  try {
    raw = storage?.getItem(LOCAL_DRAFT_KEY) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  const envelope = EnvelopeSchema.safeParse(parsed);
  const config =
    envelope.success && envelope.data.schemaVersion <= CURRENT_SCHEMA_VERSION
      ? migrateConfig(envelope.data.config)
      : null;
  if (!envelope.success || !config) {
    clearLocalDraft(storage);
    return null;
  }
  return { name: envelope.data.name, config };
}

/**
 * Whether the page was opened by reloading (or going back or forward to) the
 * URL it shows now, as opposed to a fresh visit. Reads the navigation timing
 * entry of the document; false when the browser has none.
 */
export function documentRevisited(
  entry: Pick<PerformanceNavigationTiming, 'type' | 'name'> | undefined = navigationEntry(),
  location: Pick<Location, 'href'> | undefined = typeof window === 'undefined'
    ? undefined
    : window.location,
): boolean {
  if (!entry || !location) return false;
  if (entry.type !== 'reload' && entry.type !== 'back_forward') return false;
  try {
    return new URL(entry.name).pathname === new URL(location.href).pathname;
  } catch {
    return false;
  }
}

function navigationEntry(): PerformanceNavigationTiming | undefined {
  try {
    const [entry] = performance.getEntriesByType('navigation');
    return entry as PerformanceNavigationTiming | undefined;
  } catch {
    return undefined;
  }
}

/**
 * Decides, per editor visit, whether it may restore the tab's draft: only the
 * editor the document opened with, and only when the document was reloaded
 * (or revisited through history). A later in-app visit to the creator starts a
 * new character. `visit` tells editors apart: Next's `bfcacheId`, which stays
 * the same across StrictMode remounts and back/forward and changes per push.
 */
export function createRestoreGate(revisited: () => boolean): (visit: string) => boolean {
  let first: string | undefined;
  return (visit) => {
    first ??= visit;
    return first === visit && revisited();
  };
}

export const mayRestoreLocalDraft = createRestoreGate(() => documentRevisited());
