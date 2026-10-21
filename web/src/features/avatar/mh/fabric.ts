/**
 * Parameters of Unreal's MetaHuman fabric material (M_fabric_simpler) as the
 * outfit converter writes them (`extras.mh.materials[<glTF material name>]`,
 * contract: docs/specs/2026-10-20-metahuman-web-assets.md, "Outfit GLBs").
 * Pure planning: which maps a material samples, which flat constants stand in
 * for the rest, and which static switches become shader defines. The shader
 * itself lives in ./fabricMaterial.ts.
 */
import type { Rgb } from './hairColor';

export type FabricShader = 'mh-fabric-v1' | 'mh-jeans-v1' | 'plain';

/** One texture slot: a map file, a flat constant, or a map the export lacked. */
export interface FabricTextureRef {
  file?: string;
  constant?: number[];
  missing?: string;
  srgb?: boolean;
  tiling?: boolean;
  /** Mean RGB of a tiling colour map (detail colour is divided by it). */
  average?: number[];
  source_convention?: 'opengl' | 'directx';
}

export interface OutfitMaterialSpec {
  shader: FabricShader;
  ue?: string;
  textures?: Record<string, FabricTextureRef>;
  scalars?: Record<string, number>;
  /** Linear RGBA. */
  vectors?: Record<string, number[]>;
  switches?: Record<string, boolean>;
}

/** Slots the fabric shader reads. */
export const FABRIC_SLOTS = [
  'Masks',
  'CustomStitch',
  'DetailTex_Variation',
  'detailTex_normal',
  'MacroTex_Variation',
  'DetailTex_Color',
  'B_DetailTex_Variation',
  'B_detailTex_normal',
  'B_MacroTex_Variation',
  'B_DetailTex_Color',
  'Wrinkle_normal',
  'Pill_n_map',
  'Pilling_A',
] as const;
export type FabricSlot = (typeof FABRIC_SLOTS)[number];

/**
 * Tiled slots whose red channel is all the graph reads. They share RGBA
 * packs (one source per channel), so a material never needs more samplers
 * than the budget below, whichever switches it turns on.
 */
export const PACKED_SLOTS: ReadonlySet<FabricSlot> = new Set<FabricSlot>([
  'DetailTex_Variation',
  'MacroTex_Variation',
  'DetailTex_Color',
  'B_DetailTex_Variation',
  'B_MacroTex_Variation',
  'B_DetailTex_Color',
  'Pilling_A',
]);

/**
 * Samplers left for the fabric maps. WebGL2 guarantees 16 units per program;
 * three takes the normal, AO, environment and DFG maps, the bone and morph
 * textures of the skinned garment (6) and a shadow map per shadowed light
 * (the studio rigs have one; two leave room for 8). Six own maps plus two
 * packs of the seven packed slots fill it at most.
 */
export const MAX_FABRIC_SAMPLERS = 8;

/** RGBA channels per pack. */
const PACK_CHANNELS = 4;

const FLAT_NORMAL = [0.5, 0.5, 1, 1];

/** What an absent map means: the value that leaves the graph unchanged. */
const NEUTRAL: Record<FabricSlot, number[]> = {
  Masks: [0.5, 0, 0, 0.5],
  CustomStitch: [0, 0, 0, 0],
  DetailTex_Variation: [0.5, 0.5, 0.5, 0.5],
  detailTex_normal: FLAT_NORMAL,
  MacroTex_Variation: [0.5, 0.5, 0.5, 0.5],
  DetailTex_Color: [1, 1, 1, 1],
  B_DetailTex_Variation: [0.5, 0.5, 0.5, 0.5],
  B_detailTex_normal: FLAT_NORMAL,
  B_MacroTex_Variation: [0.5, 0.5, 0.5, 0.5],
  B_DetailTex_Color: [1, 1, 1, 1],
  Wrinkle_normal: FLAT_NORMAL,
  Pill_n_map: FLAT_NORMAL,
  Pilling_A: [0, 0, 0, 0],
};

/** Static switches of the graph that compile into the shader. */
const SWITCH_DEFINES: Record<string, string> = {
  DoDetailColor: 'FAB_A_DETAIL_COLOR',
  DoDetailNormal: 'FAB_A_DETAIL_NORMAL',
  DoDetailVariation: 'FAB_A_DETAIL_VARIATION',
  DoMacroVariation: 'FAB_A_MACRO_VARIATION',
  DoPaintedWear: 'FAB_A_PAINTED_WEAR',
  DoSculptDetail: 'FAB_A_SCULPT_DETAIL',
  B_DoDetailColor: 'FAB_B_DETAIL_COLOR',
  B_DoDetailNormal: 'FAB_B_DETAIL_NORMAL',
  B_DoDetailVariation: 'FAB_B_DETAIL_VARIATION',
  B_DoMacroVariation: 'FAB_B_MACRO_VARIATION',
  B_DoPaintedWear: 'FAB_B_PAINTED_WEAR',
  B_DoSculptDetail: 'FAB_B_SCULPT_DETAIL',
  B_UseAColor: 'FAB_B_USE_A_COLOR',
  'MaterialB option': 'FAB_MATERIAL_B',
  CustomStitchtx_diffuse_color_2: 'FAB_STITCH_COLOR_2',
  DoFuzz: 'FAB_FUZZ',
  DoPill: 'FAB_PILL',
  DoWrinkles: 'FAB_WRINKLES',
  DoMaterialC: 'FAB_MATERIAL_C',
  C_UseAColor: 'FAB_C_USE_A_COLOR',
  'C- use metallic map': 'FAB_C_METAL_MAP',
  'C- use roughness map': 'FAB_C_ROUGH_MAP',
};

/** Where a packed slot reads its value: a pack and one of its channels. */
export interface PackedChannel {
  pack: number;
  channel: number;
}

export interface FabricPlan {
  /** Slots read from a map of their own, by file. */
  maps: Partial<Record<FabricSlot, string>>;
  /** Packs to build: the red channel of each file goes to its channel. */
  packs: string[][];
  /** Packed slots, by pack channel (slots of one file share it). */
  packed: Partial<Record<FabricSlot, PackedChannel>>;
  /** Slots read as a flat RGBA constant. */
  constants: Partial<Record<FabricSlot, number[]>>;
  /** Shader defines of the static switches. */
  defines: string[];
}

const on = (spec: OutfitMaterialSpec, name: string) => spec.switches?.[name] === true;

/** Whether the graph reads a slot at all under this material's switches. */
export function slotUsed(spec: OutfitMaterialSpec, slot: FabricSlot): boolean {
  const regionB = slot.startsWith('B_');
  if (regionB && !on(spec, 'MaterialB option')) return false;
  const p = regionB ? 'B_' : '';
  switch (slot) {
    case 'Masks':
    case 'CustomStitch':
      return true;
    case 'DetailTex_Variation':
    case 'B_DetailTex_Variation':
      // Variation also drives the specular level unless the sculpt mask replaces it.
      return !on(spec, `${p}DoSculptDetail`);
    case 'detailTex_normal':
    case 'B_detailTex_normal':
      return on(spec, `${p}DoDetailNormal`);
    case 'MacroTex_Variation':
    case 'B_MacroTex_Variation':
      return on(spec, `${p}DoMacroVariation`);
    case 'DetailTex_Color':
    case 'B_DetailTex_Color':
      return true;
    case 'Wrinkle_normal':
      return on(spec, 'DoWrinkles');
    case 'Pill_n_map':
    case 'Pilling_A':
      return on(spec, 'DoPill');
  }
}

/**
 * Which slots sample a map, which read a pack channel and which a constant.
 * Slots the switches never read, flat exports and missing maps become
 * constants.
 */
export function planFabric(spec: OutfitMaterialSpec): FabricPlan {
  const maps: Partial<Record<FabricSlot, string>> = {};
  const packed: Partial<Record<FabricSlot, PackedChannel>> = {};
  const constants: Partial<Record<FabricSlot, number[]>> = {};
  const channels: string[] = [];
  for (const slot of FABRIC_SLOTS) {
    const ref = spec.textures?.[slot];
    if (!slotUsed(spec, slot) || !ref?.file) {
      constants[slot] = constantOf(ref, slot);
    } else if (PACKED_SLOTS.has(slot)) {
      let index = channels.indexOf(ref.file);
      if (index < 0) index = channels.push(ref.file) - 1;
      packed[slot] = { pack: Math.floor(index / PACK_CHANNELS), channel: index % PACK_CHANNELS };
    } else {
      maps[slot] = ref.file;
    }
  }
  const packs: string[][] = [];
  for (let i = 0; i < channels.length; i += PACK_CHANNELS) {
    packs.push(channels.slice(i, i + PACK_CHANNELS));
  }
  const defines = Object.entries(SWITCH_DEFINES)
    .filter(([name]) => on(spec, name))
    .map(([, define]) => define);
  return { maps, packs, packed, constants, defines: defines.sort() };
}

/** Samplers a plan binds (own maps and packs). */
export const samplersOf = (plan: FabricPlan) => Object.keys(plan.maps).length + plan.packs.length;

function constantOf(ref: FabricTextureRef | undefined, slot: FabricSlot): number[] {
  const value = ref?.constant;
  if (!value || value.length === 0) return [...NEUTRAL[slot]];
  return [0, 1, 2, 3].map((i) => value[i] ?? value[value.length - 1] ?? 0);
}

/** A fabric scalar with Unreal's material default when the instance did not set it. */
export function scalar(spec: OutfitMaterialSpec, name: string, fallback: number): number {
  const value = spec.scalars?.[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A fabric colour (linear RGB). */
export function vector(spec: OutfitMaterialSpec, name: string, fallback: Rgb): Rgb {
  const value = spec.vectors?.[name];
  return value && value.length >= 3 ? [value[0]!, value[1]!, value[2]!] : fallback;
}

/** 1 / mean red of a tiling detail colour map (its texels are normalised by it). */
export function inverseAverage(ref: FabricTextureRef | undefined): number {
  const red = ref?.file ? ref.average?.[0] : undefined;
  return red && red > 1e-3 ? 1 / red : 1;
}

/** The colour parameters a fabric material exposes to the creator. */
export const COLOR_PARAMS = ['diffuse_color_1', 'diffuse_color_2', 'B_diffuse_color_1', 'C_color'];

/**
 * Splits creator colours (`<param>` or `<material>.<param>` for garments with
 * several materials, as the manifest names them) into per-material overrides.
 */
export function colorsByMaterial(
  colors: Readonly<Record<string, Rgb>>,
  materials: readonly string[],
): Map<string, Record<string, Rgb>> {
  const out = new Map<string, Record<string, Rgb>>(materials.map((name) => [name, {}]));
  const single = materials.length === 1 ? materials[0] : undefined;
  for (const [key, color] of Object.entries(colors)) {
    const dot = key.lastIndexOf('.');
    const material = dot > 0 ? key.slice(0, dot) : single;
    const param = dot > 0 ? key.slice(dot + 1) : key;
    if (material && out.has(material) && COLOR_PARAMS.includes(param)) {
      out.get(material)![param] = color;
    }
  }
  return out;
}
