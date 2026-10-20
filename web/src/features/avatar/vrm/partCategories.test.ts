import { describe, expect, it } from 'vitest';

import { classifyMaterial, isOnepiece, isPartCategory } from './partCategories';

describe('classifyMaterial', () => {
  it.each([
    ['N00_000_Hair_00_HAIR_01 (Instance)', 'hair'],
    ['N00_000_00_HairBack_00_HAIR (Instance)', 'hair'],
    ['N00_007_01_Tops_01_CLOTH (Instance)', 'top'],
    ['N00_010_01_Onepiece_00_CLOTH (Instance)', 'top'],
    ['N00_001_03_Bottoms_01_CLOTH (Instance)', 'bottom'],
    ['N00_005_01_Shoes_01_CLOTH (Instance)', 'shoes'],
    ['N00_000_00_FaceMouth_00_FACE (Instance)', 'face'],
    ['N00_000_00_EyeIris_00_EYE (Instance)', 'face'],
    ['N00_000_00_Face_00_SKIN (Instance)', 'face'],
    ['N00_000_00_Body_00_SKIN (Instance)', 'body'],
    ['N00_003_01_Accessory_01_CLOTH (Instance)', 'accessory'],
    ['SomethingElse', 'other'],
  ] as const)('%s -> %s', (name, role) => {
    expect(classifyMaterial(name)).toBe(role);
  });

  it('keeps outline material copies in the same category', () => {
    expect(classifyMaterial('N00_007_01_Tops_01_CLOTH (Instance) (Outline)')).toBe('top');
  });
});

describe('helpers', () => {
  it('detects one-piece garments', () => {
    expect(isOnepiece('N00_010_01_Onepiece_00_CLOTH')).toBe(true);
    expect(isOnepiece('N00_007_01_Tops_01_CLOTH')).toBe(false);
  });

  it('distinguishes part categories from base roles', () => {
    expect(isPartCategory('shoes')).toBe(true);
    expect(isPartCategory('face')).toBe(false);
  });
});
