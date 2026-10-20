import { Color, Group, Mesh, MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';

import { applyTints, tintTargetOf } from './tint';

function meshWithMaterial(name: string, hex: string) {
  const material = new MeshBasicMaterial({ color: new Color(hex) });
  material.name = name;
  return new Mesh(undefined, material);
}

describe('tintTargetOf', () => {
  it.each([
    ['N00_000_00_EyeIris_00_EYE (Instance)', 'eyes'],
    ['N00_000_00_Face_00_SKIN (Instance)', 'skin'],
    ['N00_000_00_Body_00_SKIN (Instance)', 'skin'],
    ['N00_000_Hair_00_HAIR_01 (Instance)', 'hair'],
    ['N00_007_01_Tops_01_CLOTH (Instance)', 'top'],
    ['N00_000_00_FaceBrow_00_FACE (Instance)', undefined],
  ] as const)('%s -> %s', (name, target) => {
    expect(tintTargetOf(name)).toBe(target);
  });
});

describe('applyTints', () => {
  it('multiplies the authored colour by the tint', () => {
    const hair = meshWithMaterial('N00_000_Hair_00_HAIR_01', '#ffffff');
    const root = new Group().add(hair);
    applyTints(root, { hair: '#ff0000' });
    expect((hair.material as MeshBasicMaterial).color.getHexString()).toBe('ff0000');
  });

  it('is idempotent and resets to the authored colour when the tint is removed', () => {
    const top = meshWithMaterial('N00_007_01_Tops_01_CLOTH', '#808080');
    const root = new Group().add(top);
    applyTints(root, { top: '#ff0000' });
    applyTints(root, { top: '#ff0000' });
    const tinted = (top.material as MeshBasicMaterial).color.getHexString();
    applyTints(root, {});
    expect(tinted).toBe(new Color('#808080').multiply(new Color('#ff0000')).getHexString());
    expect((top.material as MeshBasicMaterial).color.getHexString()).toBe('808080');
  });

  it('ignores materials that are not customizable', () => {
    const brow = meshWithMaterial('N00_000_00_FaceBrow_00_FACE', '#123456');
    applyTints(new Group().add(brow), { hair: '#ff0000' });
    expect((brow.material as MeshBasicMaterial).color.getHexString()).toBe('123456');
  });
});
