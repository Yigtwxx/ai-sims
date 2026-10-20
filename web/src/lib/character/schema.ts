import { z } from 'zod';

/** Bump when the config shape changes and add a migration. */
export const CURRENT_SCHEMA_VERSION = 1 as const;

export const CHARACTER_BASES = ['male', 'female'] as const;

/** Anime is the main style; realistic is a side option the user can pick. */
export const CHARACTER_STYLES = ['anime', 'realistic'] as const;

const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a #RRGGBB hex color');
const UnitIntervalSchema = z.number().min(0).max(1);

/** A wearable referencing a manifest id, optionally tinted. */
const OutfitItemSchema = z.object({
  id: z.string().min(1),
  color: HexColorSchema.optional(),
});

/**
 * Render-independent character description. It only references manifest ids,
 * never meshes or textures, so the renderer can change without data migrations.
 */
export const CharacterConfigSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  style: z.enum(CHARACTER_STYLES),
  base: z.enum(CHARACTER_BASES),
  face: z.object({
    preset: z.string().min(1),
    /** Morph blend weights between face presets, keyed by preset id. */
    blend: z.record(z.string(), UnitIntervalSchema),
  }),
  skin: z.object({
    /** Position along the melanin ramp, 0..1. */
    tone: UnitIntervalSchema,
  }),
  eyes: z.object({ color: HexColorSchema }),
  hair: z.object({ style: z.string().min(1), color: HexColorSchema }),
  facialHair: z.object({ style: z.string().min(1).nullable(), color: HexColorSchema }),
  outfit: z.object({
    top: OutfitItemSchema,
    bottom: OutfitItemSchema,
    shoes: OutfitItemSchema,
  }),
});

export type CharacterConfig = z.infer<typeof CharacterConfigSchema>;
export type CharacterBase = CharacterConfig['base'];
export type CharacterStyle = CharacterConfig['style'];
export type OutfitItem = z.infer<typeof OutfitItemSchema>;
