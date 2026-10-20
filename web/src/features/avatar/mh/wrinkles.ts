/**
 * MetaHuman wrinkle maps ("animated maps"). RigLogic drives one weight per face
 * region (head_wm1_blink_L, ...); each wrinkle normal set (wm1..wm3) blends
 * towards its sculpted normal map where its regions are active. The converter
 * writes, per ARKit morph, which regions it drives (extras.mh.animated_maps:
 * morph -> {"head_wm1_normal.head_wm1_blink_L": weight, ...}).
 *
 * Region masks come in ten RGBA textures. Within each mask set the regions are
 * packed four per texture in alphabetical order (verified on the DCC masks:
 * every channel's UV centroid lands on its region, left on +u).
 */

export const WRINKLE_REGIONS = {
  wm1: [
    'blink_L',
    'blink_R',
    'browsRaiseInner_L',
    'browsRaiseInner_R',
    'browsRaiseOuter_L',
    'browsRaiseOuter_R',
    'chinRaise_L',
    'chinRaise_R',
    'jawOpen',
    'purse_DL',
    'purse_DR',
    'purse_UL',
    'purse_UR',
    'squintInner_L',
    'squintInner_R',
  ],
  wm2: [
    'browsDown_L',
    'browsDown_R',
    'browsLateral_L',
    'browsLateral_R',
    'mouthStretch_L',
    'mouthStretch_R',
    'neckStretch_L',
    'neckStretch_R',
    'noseWrinkler_L',
    'noseWrinkler_R',
  ],
  wm3: [
    'cheekRaiseInner_L',
    'cheekRaiseInner_R',
    'cheekRaiseOuter_L',
    'cheekRaiseOuter_R',
    'cheekRaiseUpper_L',
    'cheekRaiseUpper_R',
    'smile_L',
    'smile_R',
  ],
  wm13: ['lips_DL', 'lips_DR', 'lips_UL', 'lips_UR'],
} as const;

export type MaskSet = keyof typeof WRINKLE_REGIONS;

/** Mask textures in array-layer order (file stems in skins/masks/<hash>/). */
export const WRINKLE_MASK_LAYERS = [
  'head_wm1_msk_01',
  'head_wm1_msk_02',
  'head_wm1_msk_03',
  'head_wm1_msk_04',
  'head_wm2_msk_01',
  'head_wm2_msk_02',
  'head_wm2_msk_03',
  'head_wm3_msk_01',
  'head_wm3_msk_02',
  'head_wm13_msk_01',
] as const;

/** Normal sets blended in this order: wm1, wm2, wm3. */
export const NORMAL_SETS = ['wm1', 'wm2', 'wm3'] as const;
export type NormalSet = (typeof NORMAL_SETS)[number];

const LAYER_COUNT = WRINKLE_MASK_LAYERS.length;
/** One vec4 of channel weights per (normal set, mask layer). */
export const WRINKLE_WEIGHT_COUNT = NORMAL_SETS.length * LAYER_COUNT * 4;

export interface MaskSlot {
  layer: number;
  channel: number;
}

/** Mask layer and RGBA channel of a region like "head_wm1_blink_L" or "head_wm13_lips_UL". */
export function regionSlot(region: string): MaskSlot | null {
  const match = /^head_(wm1|wm2|wm3|wm13)_(.+)$/.exec(region);
  if (!match) return null;
  const set = match[1] as MaskSet;
  const index = (WRINKLE_REGIONS[set] as readonly string[]).indexOf(match[2]!);
  if (index < 0) return null;
  const mask = `head_${set}_msk_${String(Math.floor(index / 4) + 1).padStart(2, '0')}`;
  const layer = (WRINKLE_MASK_LAYERS as readonly string[]).indexOf(mask);
  return layer < 0 ? null : { layer, channel: index % 4 };
}

export type AnimatedMaps = Record<string, Record<string, number>>;

/** Per morph index: flat weight slots it adds to and how much. */
export interface WrinkleTable {
  slots: Int32Array[];
  weights: Float32Array[];
}

/**
 * Compiles extras.mh.animated_maps against a mesh's morph dictionary. Only the
 * normal sets are used (the color sets are not shaded yet).
 */
export function compileWrinkleTable(
  maps: AnimatedMaps,
  dictionary: Record<string, number>,
): WrinkleTable {
  const count = Math.max(-1, ...Object.values(dictionary)) + 1;
  const slots: number[][] = Array.from({ length: count }, () => []);
  const weights: number[][] = Array.from({ length: count }, () => []);
  for (const [morph, targets] of Object.entries(maps)) {
    const index = dictionary[morph];
    if (index === undefined) continue;
    for (const [target, weight] of Object.entries(targets)) {
      const [map, region] = target.split('.');
      const set = /^head_(wm[123])_normal$/.exec(map ?? '')?.[1] as NormalSet | undefined;
      const slot = region ? regionSlot(region) : null;
      if (!set || !slot) continue;
      const base = (NORMAL_SETS.indexOf(set) * LAYER_COUNT + slot.layer) * 4;
      slots[index]!.push(base + slot.channel);
      weights[index]!.push(weight);
    }
  }
  return {
    slots: slots.map((s) => Int32Array.from(s)),
    weights: weights.map((w) => Float32Array.from(w)),
  };
}

/**
 * Region weights for the current morph influences, written into `out`
 * (WRINKLE_WEIGHT_COUNT floats, clamped to 0..1 like RigLogic's outputs).
 * Returns whether any region is active, so the shader can skip the work.
 */
export function computeWrinkleWeights(
  influences: ArrayLike<number>,
  table: WrinkleTable,
  out: Float32Array,
): boolean {
  out.fill(0);
  for (let morph = 0; morph < table.slots.length; morph += 1) {
    const influence = influences[morph] ?? 0;
    if (influence <= 0) continue;
    const slots = table.slots[morph]!;
    const weights = table.weights[morph]!;
    for (let k = 0; k < slots.length; k += 1) out[slots[k]!]! += influence * weights[k]!;
  }
  let active = false;
  for (let i = 0; i < out.length; i += 1) {
    const value = Math.min(1, out[i]!);
    out[i] = value;
    if (value > 1e-3) active = true;
  }
  return active;
}
