import { z } from 'zod';

/**
 * JSON shape of baked body profiles (`/assets/vrm/profiles.json`), keyed by
 * source model. Written by the profile bake page, read by the creator.
 */

const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
const BinsSchema = z.record(z.string().regex(/^\d+:\d+$/), z.number().positive());

export const BodyProfileSchema = z.object({
  head: z.object({ centre: Vec3Schema, bins: BinsSchema }).optional(),
  limbs: z.record(
    z.string(),
    z.object({ axis: Vec3Schema, length: z.number().positive(), bins: BinsSchema }),
  ),
});

export const ProfilesFileSchema = z.object({
  version: z.literal(1),
  sources: z.record(z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), BodyProfileSchema),
});

export type ProfilesFile = z.infer<typeof ProfilesFileSchema>;

export const PROFILES_URL = '/assets/vrm/profiles.json';
