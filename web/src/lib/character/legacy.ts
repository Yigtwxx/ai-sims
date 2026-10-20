/**
 * Schema v1 (anime/VRM era). Kept only so stored v1 configs can be migrated to v2
 * (see ./migrations.ts) and for the frozen VRM creator until it is removed.
 */
import { z } from 'zod';

/** Bump when the config shape changes and add a migration. */
export const LEGACY_SCHEMA_VERSION = 1 as const;

export const CHARACTER_BASES = ['male', 'female'] as const;

/** Anime is the main style; realistic is a side option the user can pick. */
export const CHARACTER_STYLES = ['anime', 'realistic'] as const;

const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a #RRGGBB hex color');
const UnitIntervalSchema = z.number().min(0).max(1);

export const BODY_BUILDS = ['slim', 'average', 'athletic', 'curvy'] as const;

/** Height multiplier range shared with the renderer's body shaping. */
export const HEIGHT_MIN = 0.92;
export const HEIGHT_MAX = 1.08;

/** Sentinel ids: keep the base model's own part, or wear nothing in that slot. */
export const OWN_PART = 'base';
export const NO_PART = 'none';

/** A wearable referencing a manifest id, optionally tinted. */
const OutfitItemSchema = z.object({
  id: z.string().min(1),
  color: HexColorSchema.optional(),
});

/**
 * Render-independent character description. It only references manifest ids,
 * never meshes or textures, so the renderer can change without data migrations.
 * For the anime style, colours are multiplicative tints where #ffffff keeps the
 * authored colour, and `skin.tone` picks a position on the tone ramp.
 */
export const CharacterConfigV1Schema = z.object({
  schemaVersion: z.literal(LEGACY_SCHEMA_VERSION),
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
  body: z.object({
    build: z.enum(BODY_BUILDS),
    height: z.number().min(HEIGHT_MIN).max(HEIGHT_MAX),
  }),
  /** Jewellery and accessory ids, worn together. */
  accessories: z.array(z.string().min(1)).max(8),
  /** Tattoo designs placed on body regions. */
  tattoos: z.array(z.object({ design: z.string().min(1), placement: z.string().min(1) })).max(4),
});

export type CharacterConfigV1 = z.infer<typeof CharacterConfigV1Schema>;
export type CharacterBase = CharacterConfigV1['base'];
export type CharacterStyle = CharacterConfigV1['style'];
export type OutfitItem = z.infer<typeof OutfitItemSchema>;
export type BodyBuild = CharacterConfigV1['body']['build'];
