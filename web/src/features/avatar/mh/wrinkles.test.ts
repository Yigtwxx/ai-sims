import { describe, expect, it } from 'vitest';

import {
  WRINKLE_WEIGHT_COUNT,
  compileWrinkleTable,
  computeWrinkleWeights,
  regionSlot,
} from './wrinkles';

describe('regionSlot', () => {
  it('packs each mask set alphabetically, four regions per texture', () => {
    expect(regionSlot('head_wm1_blink_L')).toEqual({ layer: 0, channel: 0 });
    expect(regionSlot('head_wm1_browsRaiseInner_R')).toEqual({ layer: 0, channel: 3 });
    expect(regionSlot('head_wm1_jawOpen')).toEqual({ layer: 2, channel: 0 });
    expect(regionSlot('head_wm1_squintInner_R')).toEqual({ layer: 3, channel: 2 });
    expect(regionSlot('head_wm2_noseWrinkler_L')).toEqual({ layer: 6, channel: 0 });
    expect(regionSlot('head_wm3_smile_R')).toEqual({ layer: 8, channel: 3 });
    expect(regionSlot('head_wm13_lips_UL')).toEqual({ layer: 9, channel: 2 });
  });

  it('rejects unknown regions', () => {
    expect(regionSlot('head_wm1_unknown')).toBeNull();
    expect(regionSlot('teeth')).toBeNull();
  });
});

describe('wrinkle weights', () => {
  const maps = {
    eyeBlinkLeft: {
      'head_cm1_color.head_wm1_blink_L': 1,
      'head_wm1_normal.head_wm1_blink_L': 1,
      'head_wm1_normal.head_wm1_squintInner_L': 0.3,
    },
    mouthSmileLeft: {
      'head_wm3_normal.head_wm3_smile_L': 1,
      'head_wm3_normal.head_wm13_lips_UL': 0.5,
    },
  };
  const dictionary = { eyeBlinkLeft: 0, jawOpen: 1, mouthSmileLeft: 2 };
  const table = compileWrinkleTable(maps, dictionary);
  const out = new Float32Array(WRINKLE_WEIGHT_COUNT);
  // Flat index of (normal set, layer, channel).
  const at = (set: number, layer: number, channel: number) => out[(set * 10 + layer) * 4 + channel];

  it('is inactive at rest', () => {
    expect(computeWrinkleWeights([0, 0, 0], table, out)).toBe(false);
  });

  it('drives the normal-set regions of active morphs, ignoring color sets', () => {
    expect(computeWrinkleWeights([0.5, 0, 0], table, out)).toBe(true);
    expect(at(0, 0, 0)).toBeCloseTo(0.5);
    expect(at(0, 3, 1)).toBeCloseTo(0.15);
    expect(out.reduce((sum, v) => sum + v, 0)).toBeCloseTo(0.65);
  });

  it('routes shared lip regions to the set that names them and clamps to 1', () => {
    computeWrinkleWeights([0, 0, 2], table, out);
    expect(at(2, 8, 2)).toBe(1);
    expect(at(2, 9, 2)).toBe(1);
  });
});
