import { z } from 'zod';

/**
 * MetaHuman asset manifest (v2), written by the pipeline converter and served from
 * `/assets/mh/manifest.json`. Contract: docs/specs/2026-10-20-metahuman-web-assets.md.
 * File paths inside the manifest are relative to ASSET_ROOT.
 */
export const ASSET_ROOT = '/assets/mh';
export const MANIFEST_URL = `${ASSET_ROOT}/manifest.json`;
export const CURATION_URL = `${ASSET_ROOT}/curation.json`;

const Id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, 'Expected a file-safe id');
const File = z.string().min(1);
const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Labels come from the pipeline (preset names, Fab titles); UI copy stays in messages. */
const Label = z.union([z.string().min(1), z.object({ tr: z.string(), en: z.string() })]);

export const GENDERS = ['female', 'male'] as const;
const Gender = z.enum(GENDERS);
const Compat = z.enum(['female', 'male', 'unisex']);

const ParamSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['float', 'color', 'bool', 'int', 'texture']),
  default: z.union([z.number(), z.boolean(), Hex, z.string()]),
  min: z.number().optional(),
  max: z.number().optional(),
});

const TintPresetSchema = z.object({
  id: Id,
  label: Label.optional(),
  /** Parameter name -> value (colours as #RRGGBB). */
  values: z.record(z.string(), z.union([z.number(), Hex])),
});

export const FaceSchema = z.object({
  id: Id,
  label: Label,
  gender: Gender,
  head: File,
  thumbnail: File.optional(),
  defaultSkin: Id,
  defaultIris: Id.optional(),
});

const FaceMapsSchema = z.object({
  albedo: File,
  normal: File,
  cavity: File.optional(),
  srmf: File.optional(),
  wrinkleColor: z.array(File).max(3).default([]),
  wrinkleNormal: z.array(File).max(3).default([]),
  wrinkleMasks: z.array(File).default([]),
  /**
   * The underwear top's straps where the head reaches the shoulders: a mask
   * (R) and the cloth colour, drawn with the body's top.
   */
  underwear: z.object({ mask: File, color: Hex }).optional(),
});

const BodyMapsSchema = z.object({
  /** Bare skin: the converter fills the underwear baked into the source albedo. */
  albedo: File,
  normal: File,
  cavity: File.optional(),
  srmf: File.optional(),
  /**
   * Shared underwear the shader draws over the bare skin where no garment
   * covers it: mask R the top (women only), G the briefs; albedo and normal
   * the cloth.
   */
  underwear: z.object({ mask: File, albedo: File, normal: File.optional() }).optional(),
});

export const SkinSchema = z.object({
  id: Id,
  label: Label,
  /** 0 (lightest) .. 1 (darkest), estimated from the albedo; the creator sorts by it. */
  tone: z.number().min(0).max(1),
  swatch: Hex,
  face: FaceMapsSchema,
  body: BodyMapsSchema,
  /** Makeup-baked face albedo, when the preset wears makeup. */
  makeupAlbedo: File.optional(),
});

const SliderSchema = z.object({
  id: z.string().min(1),
  min: z.number(),
  max: z.number(),
  default: z.number(),
});

export const BODY_PRESETS = ['slim', 'average', 'athletic', 'curvy'] as const;

export const BodySchema = z.object({
  gender: Gender,
  glb: File,
  sliders: z.array(SliderSchema).min(1),
  // Zod 4 records with enum keys are exhaustive; a body may define only some presets.
  presets: z.partialRecord(z.enum(BODY_PRESETS), z.record(z.string(), z.number())),
});

export const GROOM_SLOTS = [
  'hair',
  'eyebrows',
  'beard',
  'mustache',
  'eyelashes',
  'peachfuzz',
] as const;

export const GroomSchema = z.object({
  id: Id,
  slot: z.enum(GROOM_SLOTS),
  label: Label,
  compat: Compat.default('unisex'),
  /** Cards GLB; a painted groom has none. */
  glb: File.optional(),
  /**
   * Head-UV map (A: coverage, strand by strand) of a groom Unreal draws from
   * strands only (stubble, buzz cuts): the head skin paints it in the hair colour.
   */
  painted: File.optional(),
  thumbnail: File.optional(),
  textures: z.record(z.string(), File).default({}),
  params: z.array(ParamSchema).default([]),
});

export const OUTFIT_CATEGORIES = ['top', 'bottom', 'shoes', 'full'] as const;

export const OutfitSchema = z.object({
  id: Id,
  category: z.enum(OUTFIT_CATEGORIES),
  label: Label,
  compat: Compat.default('unisex'),
  files: z.object({ female: File.optional(), male: File.optional() }),
  thumbnail: File.optional(),
  params: z.array(ParamSchema).default([]),
  tintPresets: z.array(TintPresetSchema).default([]),
  hidesBodyRegions: z.array(z.string()).default([]),
});

export const IrisSchema = z.object({
  id: Id,
  label: Label,
  color: File,
  normal: File.optional(),
  swatch: Hex,
});

export const AnimationSchema = z.object({
  id: Id,
  kind: z.enum(['body', 'face']),
  file: File,
  loop: z.boolean().default(true),
  tags: z.array(z.string()).default([]),
});

export const LightingSchema = z.object({
  id: Id,
  label: Label,
  environment: File.optional(),
  file: File,
});

export const MhManifestSchema = z.object({
  version: z.literal(2),
  generatedAt: z.string(),
  faces: z.array(FaceSchema),
  skins: z.array(SkinSchema),
  bodies: z.array(BodySchema),
  grooms: z.array(GroomSchema).default([]),
  outfits: z.array(OutfitSchema).default([]),
  irises: z.array(IrisSchema).default([]),
  animations: z.array(AnimationSchema).default([]),
  lighting: z.array(LightingSchema).default([]),
});

/**
 * Why the similarity pre-pass (`asset-pipeline mh-similar --apply`) hid an item:
 * the item kept in its place and how far apart the two are.
 */
export const AutoPickSchema = z.object({
  keep: z.string(),
  /** English label of the kept item, written by the pipeline. */
  keepLabel: z.string(),
  distance: z.number(),
  unit: z.enum(['mm', 'deg']),
});

export const CurationSchema = z.object({
  hidden: z.array(z.string()).default([]),
  /**
   * Pre-pass picks by id. A pick is normally also in `hidden`; one the curator
   * restored has left `hidden` but stays here, so the pre-pass will not hide it again.
   */
  auto: z.record(z.string(), AutoPickSchema).default({}),
});

/** The part of the curation the creator needs; a malformed `auto` never drops the hidden list. */
const HiddenOnlySchema = CurationSchema.pick({ hidden: true });

export type MhManifest = z.infer<typeof MhManifestSchema>;
export type MhFace = z.infer<typeof FaceSchema>;
export type MhSkin = z.infer<typeof SkinSchema>;
export type MhBody = z.infer<typeof BodySchema>;
export type MhGroom = z.infer<typeof GroomSchema>;
export type MhOutfit = z.infer<typeof OutfitSchema>;
export type MhIris = z.infer<typeof IrisSchema>;
export type MhAnimation = z.infer<typeof AnimationSchema>;
export type MhLighting = z.infer<typeof LightingSchema>;
export type GroomSlot = (typeof GROOM_SLOTS)[number];
export type OutfitCategory = (typeof OUTFIT_CATEGORIES)[number];
export type Curation = z.infer<typeof CurationSchema>;
export type AutoPick = z.infer<typeof AutoPickSchema>;

/** Absolute URL of a manifest-relative file. */
export function assetUrl(file: string): string {
  return `${ASSET_ROOT}/${file.replace(/^\/+/, '')}`;
}

/** Resolves a label for the active locale; plain strings are used as-is. */
export function labelFor(label: z.infer<typeof Label>, locale: string): string {
  if (typeof label === 'string') return label;
  return locale === 'tr' ? label.tr : label.en;
}

/** Drops curated-out items from every list. Ids are unique across categories. */
export function applyCuration(
  manifest: MhManifest,
  curation: Pick<Curation, 'hidden'>,
): MhManifest {
  if (curation.hidden.length === 0) return manifest;
  const hidden = new Set(curation.hidden);
  const keep = <T extends { id: string }>(items: T[]) =>
    items.filter((item) => !hidden.has(item.id));
  return {
    ...manifest,
    faces: keep(manifest.faces),
    skins: keep(manifest.skins),
    grooms: keep(manifest.grooms),
    outfits: keep(manifest.outfits),
    irises: keep(manifest.irises),
    animations: keep(manifest.animations),
    lighting: keep(manifest.lighting),
  };
}

let pending: Promise<MhManifest> | null = null;

/**
 * Loads and validates the manifest once per page; a failed load is retried on the
 * next call. `curated: false` (the curation screen) keeps hidden items visible.
 */
export async function loadMhManifest({ curated = true } = {}): Promise<MhManifest> {
  pending ??= fetch(MANIFEST_URL, { cache: 'no-cache' })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Manifest request failed: ${response.status}`);
      return MhManifestSchema.parse(await response.json());
    })
    .catch((error: unknown) => {
      pending = null;
      throw error;
    });
  const manifest = await pending;
  if (!curated) return manifest;
  const curation = await fetch(CURATION_URL, { cache: 'no-cache' })
    .then(async (response) => (response.ok ? HiddenOnlySchema.parse(await response.json()) : null))
    .catch(() => null);
  return curation ? applyCuration(manifest, curation) : manifest;
}
