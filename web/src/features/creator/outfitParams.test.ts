import { describe, expect, it } from 'vitest';

import { colorParamLabels } from './outfitParams';

describe('colorParamLabels', () => {
  it('names the fabric shader slots instead of showing raw param names', () => {
    expect(
      colorParamLabels(['diffuse_color_1', 'diffuse_color_2', 'B_diffuse_color_1', 'C_color']),
    ).toEqual([
      { key: 'PrimaryColor', piece: null },
      { key: 'SecondaryColor', piece: null },
      { key: 'DetailColor', piece: null },
      { key: 'AccentColor', piece: null },
    ]);
  });

  it('numbers the pieces of a multi-material outfit in material order', () => {
    expect(
      colorParamLabels([
        'Jacket.diffuse_color_1',
        'Pants.diffuse_color_1',
        'Jacket.C_color',
        'Pants.diffuse_color_2',
      ]),
    ).toEqual([
      { key: 'PrimaryColor', piece: 1 },
      { key: 'PrimaryColor', piece: 2 },
      { key: 'AccentColor', piece: 1 },
      { key: 'SecondaryColor', piece: 2 },
    ]);
  });

  it('leaves unknown params unnamed', () => {
    expect(colorParamLabels(['Body.Tint'])).toEqual([{ key: null, piece: null }]);
  });
});
