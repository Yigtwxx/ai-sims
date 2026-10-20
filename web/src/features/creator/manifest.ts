import { z } from 'zod';

import type { BodyProfile } from '../avatar/vrm/fitDonor';
import { PROFILES_URL, ProfilesFileSchema } from '../avatar/vrm/profileSchema';

/**
 * The anime part manifest written by the asset pipeline
 * (`uv run asset-pipeline manifest`). It is the single source of the
 * creator's option lists.
 */

const GenderSchema = z.enum(['female', 'male', 'unisex']);

const EntrySchema = z.object({
  id: z.string().min(1),
  category: z.enum(['base', 'hair', 'top', 'bottom', 'shoes']),
  gender: GenderSchema,
  label: z.string(),
  source: z.string(),
  url: z.string().startsWith('/'),
  bytes: z.number().nonnegative(),
});

export const VrmManifestSchema = z.object({
  version: z.literal(1),
  bases: z.array(EntrySchema),
  parts: z.array(EntrySchema),
});

export type VrmManifest = z.infer<typeof VrmManifestSchema>;
export type ManifestEntry = z.infer<typeof EntrySchema>;
export type PartCategory = Exclude<ManifestEntry['category'], 'base'>;
export type Gender = 'female' | 'male';

export const MANIFEST_URL = '/assets/vrm/manifest.json';

/** Poster artwork baked from the real models (see the thumbnail bake page). */
export function thumbnailUrl(id: string): string {
  return `/assets/vrm/thumbs/${id}.webp`;
}

let pending: Promise<VrmManifest> | undefined;

export function loadManifest(): Promise<VrmManifest> {
  pending ??= fetch(MANIFEST_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`Manifest request failed (${response.status})`);
      return response.json();
    })
    .then((json) => VrmManifestSchema.parse(json))
    .catch((error: unknown) => {
      // Allow a retry after a transient failure instead of caching the rejection.
      pending = undefined;
      throw error;
    });
  return pending;
}

/** Body profiles per source model; parts are used as authored when the file is missing. */
export type SourceProfiles = Record<string, BodyProfile>;

let pendingProfiles: Promise<SourceProfiles> | undefined;

export function loadProfiles(): Promise<SourceProfiles> {
  pendingProfiles ??= fetch(PROFILES_URL)
    .then(async (response) => {
      if (!response.ok) return {};
      const parsed = ProfilesFileSchema.safeParse(await response.json());
      return parsed.success ? (parsed.data.sources as SourceProfiles) : {};
    })
    .catch(() => ({}));
  return pendingProfiles;
}

const fits = (entry: ManifestEntry, gender: Gender) =>
  entry.gender === gender || entry.gender === 'unisex';

export function basesFor(manifest: VrmManifest, gender: Gender): ManifestEntry[] {
  return manifest.bases.filter((entry) => fits(entry, gender));
}

export function partsFor(
  manifest: VrmManifest,
  category: PartCategory,
  gender: Gender,
): ManifestEntry[] {
  return manifest.parts.filter((entry) => entry.category === category && fits(entry, gender));
}

export function findEntry(manifest: VrmManifest, id: string): ManifestEntry | undefined {
  return manifest.bases.find((e) => e.id === id) ?? manifest.parts.find((e) => e.id === id);
}
