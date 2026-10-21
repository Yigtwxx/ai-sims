import { describe, expect, it } from 'vitest';

import {
  FABRIC_SLOTS,
  MAX_FABRIC_SAMPLERS,
  colorsByMaterial,
  inverseAverage,
  planFabric,
  samplersOf,
  slotUsed,
  type OutfitMaterialSpec,
} from './fabric';

const hoodie: OutfitMaterialSpec = {
  shader: 'mh-fabric-v1',
  textures: {
    Masks: { file: 'outfits/OA_Hoodie/mask.ktx2' },
    CustomStitch: { constant: [0, 0, 0, 0] },
    DetailTex_Color: { constant: [1, 1, 1, 1] },
    DetailTex_Variation: { file: 'outfits/shared/knit.ktx2', tiling: true },
    MacroTex_Variation: { file: 'outfits/shared/heather.ktx2', tiling: true },
    detailTex_normal: { file: 'outfits/shared/knit_n.ktx2', source_convention: 'directx' },
    B_DetailTex_Variation: { file: 'outfits/shared/double_knit.ktx2' },
    Wrinkle_normal: { file: 'outfits/shared/wrinkle_n.ktx2' },
  },
  switches: {
    DoDetailNormal: true,
    DoMacroVariation: true,
    DoDetailVariation: true,
    'MaterialB option': false,
    DoWrinkles: false,
  },
};

describe('planFabric', () => {
  it('samples only the maps the switches read', () => {
    const plan = planFabric(hoodie);
    expect(Object.keys(plan.maps).sort()).toEqual(['Masks', 'detailTex_normal']);
    expect(plan.packs).toEqual([['outfits/shared/knit.ktx2', 'outfits/shared/heather.ktx2']]);
    expect(plan.packed).toEqual({
      DetailTex_Variation: { pack: 0, channel: 0 },
      MacroTex_Variation: { pack: 0, channel: 1 },
    });
    expect(plan.maps.Wrinkle_normal).toBeUndefined();
    expect(plan.packed.B_DetailTex_Variation).toBeUndefined();
  });

  it('gives slots that read the same file one pack channel', () => {
    const shared: OutfitMaterialSpec = {
      ...hoodie,
      textures: { ...hoodie.textures, B_DetailTex_Variation: { file: 'outfits/shared/knit.ktx2' } },
      switches: { ...hoodie.switches, 'MaterialB option': true },
    };
    const plan = planFabric(shared);
    expect(plan.packed.B_DetailTex_Variation).toEqual(plan.packed.DetailTex_Variation);
    expect(plan.packs[0]).toHaveLength(2);
  });

  it('turns flat exports and unread slots into constants', () => {
    const plan = planFabric(hoodie);
    expect(plan.constants.DetailTex_Color).toEqual([1, 1, 1, 1]);
    expect(plan.constants.Pilling_A).toEqual([0, 0, 0, 0]);
    expect(plan.constants.Wrinkle_normal).toEqual([0.5, 0.5, 1, 1]);
  });

  it('compiles the switches into defines', () => {
    const { defines } = planFabric(hoodie);
    expect(defines).toContain('FAB_A_DETAIL_NORMAL');
    expect(defines).not.toContain('FAB_MATERIAL_B');
    expect(defines).toEqual([...defines].sort());
  });

  it('fits every map of the whole graph within the sampler budget', () => {
    const every: OutfitMaterialSpec = {
      shader: 'mh-fabric-v1',
      textures: Object.fromEntries(FABRIC_SLOTS.map((slot) => [slot, { file: `${slot}.ktx2` }])),
      switches: {
        'MaterialB option': true,
        DoDetailNormal: true,
        B_DoDetailNormal: true,
        DoMacroVariation: true,
        B_DoMacroVariation: true,
        DoWrinkles: true,
        DoPill: true,
      },
    };
    const plan = planFabric(every);
    expect(Object.keys(plan.maps)).toHaveLength(6);
    expect(plan.packs.map((files) => files.length)).toEqual([4, 3]);
    expect(samplersOf(plan)).toBeLessThanOrEqual(MAX_FABRIC_SAMPLERS);
    expect(Object.keys(plan.constants)).toEqual([]);
  });
});

describe('slotUsed', () => {
  it('reads the sculpt mask instead of the variation map when sculpting', () => {
    expect(slotUsed({ shader: 'mh-fabric-v1', switches: {} }, 'DetailTex_Variation')).toBe(true);
    const sculpt = { shader: 'mh-fabric-v1', switches: { DoSculptDetail: true } } as const;
    expect(slotUsed(sculpt, 'DetailTex_Variation')).toBe(false);
  });
});

describe('inverseAverage', () => {
  it('normalises tiling colour maps by their mean red and leaves constants alone', () => {
    expect(inverseAverage({ file: 'a.ktx2', average: [0.5, 0.4, 0.3] })).toBeCloseTo(2);
    expect(inverseAverage({ constant: [1, 1, 1, 1], average: [0.5] })).toBe(1);
    expect(inverseAverage(undefined)).toBe(1);
  });
});

describe('colorsByMaterial', () => {
  it('gives plain names to a single material and prefixed names to their material', () => {
    const red: [number, number, number] = [1, 0, 0];
    expect(colorsByMaterial({ diffuse_color_1: red }, ['top']).get('top')).toEqual({
      diffuse_color_1: red,
    });
    const split = colorsByMaterial(
      { 'top.diffuse_color_2': red, 'laces.C_color': red, 'top.unknown': red },
      ['top', 'laces'],
    );
    expect(split.get('top')).toEqual({ diffuse_color_2: red });
    expect(split.get('laces')).toEqual({ C_color: red });
  });
});
