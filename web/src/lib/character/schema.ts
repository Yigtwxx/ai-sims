import { z } from 'zod';

/** Bump when the config shape changes and add a step to ./migrations.ts. */
export const CURRENT_SCHEMA_VERSION = 3 as const;

export const CHARACTER_BASES = ['male', 'female'] as const;

/**
 * Stored documents keep a `style` field. Every v2 character is photoreal
 * (MetaHuman); 'anime' only appears on v1 documents before migration.
 */
export const CHARACTER_STYLES = ['realistic'] as const;

/** Body sliders exported from the MetaHuman parametric body (pipeline bodies job). */
export const BODY_SLIDERS = [
  'height',
  'weight',
  'muscle',
  'chest',
  'waist',
  'hips',
  'shoulders',
] as const;

/** Named starting points; each is a slider vector in the manifest. */
export const BODY_PRESETS = ['slim', 'average', 'athletic', 'curvy'] as const;

export const HAIR_PATTERNS = ['none', 'ombre', 'roots', 'highlights', 'underlayer'] as const;

/** Sock lengths: ankle, below the knee, or tights from the waist (women only). */
export const SOCK_STYLES = ['none', 'ankle', 'knee', 'tights'] as const;

const Id = z.string().min(1).max(120);
const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a #RRGGBB hex color');
const UnitIntervalSchema = z.number().min(0).max(1);
const SignedUnitSchema = z.number().min(-1).max(1);

/** A wearable referencing a manifest outfit id, with optional colour parameters. */
const OutfitItemSchema = z.object({
  id: Id,
  /** Tint preset id from the manifest item, or null for the authored colours. */
  tint: Id.nullable().default(null),
  /** Outfit colour parameters (MetaHuman instance parameter name -> colour). */
  colors: z.record(z.string(), HexColorSchema).default({}),
});

const HairColorSchema = z.object({
  /** MetaHuman hair model: melanin (0 blond .. 1 black) and redness. */
  melanin: UnitIntervalSchema,
  redness: UnitIntervalSchema,
  /** Artificial dye over the natural colour, or null. */
  dye: HexColorSchema.nullable(),
});

/**
 * Render-independent character description. It only references manifest ids
 * (MetaHuman faces, skins, grooms, outfits), never meshes or textures, so the
 * renderer can change without data migrations.
 */
export const CharacterConfigSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  style: z.enum(CHARACTER_STYLES),
  base: z.enum(CHARACTER_BASES),
  face: z.object({
    preset: Id,
    /** Morph blend weights towards other face presets, keyed by face id. */
    blend: z.record(z.string(), UnitIntervalSchema),
  }),
  body: z.object({
    preset: z.enum(BODY_PRESETS),
    /** Slider values in -1..1 around the neutral body (0). */
    sliders: z.partialRecord(z.enum(BODY_SLIDERS), SignedUnitSchema),
  }),
  skin: z.object({
    /** Skin texture set id (any preset's skin can be worn by any face). */
    set: Id,
    /** Fine adjustment of the skin tone, -1 lighter .. 1 darker. */
    tone: SignedUnitSchema,
    /** Use the preset's makeup-baked face albedo when it has one. */
    makeup: z.boolean(),
  }),
  eyes: z.object({ iris: Id.nullable(), color: HexColorSchema.nullable() }),
  hair: z.object({
    style: Id.nullable(),
    color: HairColorSchema,
    pattern: z.object({
      type: z.enum(HAIR_PATTERNS),
      color: HexColorSchema,
      amount: UnitIntervalSchema,
    }),
  }),
  /** Facial hair grooms share the hair colour. */
  eyebrows: z.object({ style: Id.nullable() }),
  beard: z.object({ style: Id.nullable() }),
  mustache: z.object({ style: Id.nullable() }),
  outfit: z.object({
    top: OutfitItemSchema.nullable(),
    bottom: OutfitItemSchema.nullable(),
    shoes: OutfitItemSchema.nullable(),
    /** One-piece outfits (e.g. a costume) replace top and bottom. */
    full: OutfitItemSchema.nullable(),
  }),
  /** Drawn on the skin under the shoes; hidden wherever a garment covers the leg. */
  socks: z.object({
    style: z.enum(SOCK_STYLES),
    color: HexColorSchema,
    /** How much skin shows through tights, 0 opaque .. 1 the finest. */
    sheer: UnitIntervalSchema,
  }),
  /** Jewellery and accessory ids, worn together. */
  accessories: z.array(Id).max(8),
  /** Small tattoo designs placed on body regions. */
  tattoos: z.array(z.object({ design: Id, placement: Id })).max(4),
  voice: z.object({ gender: z.enum(['female', 'male']) }),
});

export type CharacterConfig = z.infer<typeof CharacterConfigSchema>;
export type CharacterBase = CharacterConfig['base'];
export type CharacterStyle = CharacterConfig['style'];
export type OutfitItem = z.infer<typeof OutfitItemSchema>;
export type BodySlider = (typeof BODY_SLIDERS)[number];
export type BodyPreset = (typeof BODY_PRESETS)[number];
export type HairPattern = (typeof HAIR_PATTERNS)[number];
export type SockStyle = (typeof SOCK_STYLES)[number];
