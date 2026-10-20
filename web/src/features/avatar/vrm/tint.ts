import { Color, type Material, type Mesh, type Object3D } from 'three';

import { classifyMaterial } from './partCategories';

/**
 * Colour customization for MToon materials: the authored colours are kept in
 * userData and multiplied by a tint, so re-applying is idempotent and white
 * restores the original. Multiplying can only darken or hue-shift, which is
 * why recolourable parts should be authored light.
 */

export type TintTarget = 'hair' | 'eyes' | 'skin' | 'top' | 'bottom' | 'shoes';

export type Tints = Partial<Record<TintTarget, string>>;

const COLOR_KEYS = ['color', 'shadeColorFactor'] as const;

interface Tintable extends Material {
  color?: Color;
  shadeColorFactor?: Color;
  isOutline?: boolean;
}

export function tintTargetOf(materialName: string): TintTarget | undefined {
  if (/EyeIris/i.test(materialName)) return 'eyes';
  if (/_SKIN\b/i.test(materialName)) return 'skin';
  const role = classifyMaterial(materialName);
  if (role === 'hair' || role === 'top' || role === 'bottom' || role === 'shoes') return role;
  return undefined;
}

function tintMaterial(material: Tintable, tint: Color): void {
  // MToon outline passes have their own colour; leave them alone.
  if (material.isOutline) return;
  for (const key of COLOR_KEYS) {
    const current = material[key];
    if (!(current instanceof Color)) continue;
    const storeKey = `__authored_${key}`;
    const authored = (material.userData[storeKey] as Color | undefined) ?? current.clone();
    material.userData[storeKey] = authored;
    current.copy(authored).multiply(tint);
  }
}

/** Apply tints to every mesh under `root`; omitted targets reset to authored colours. */
export function applyTints(root: Object3D, tints: Tints): void {
  const white = new Color(1, 1, 1);
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh) return;
    const materials = (
      Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    ) as Tintable[];
    const target = tintTargetOf(materials[0]?.name ?? '');
    if (!target) return;
    const hex = tints[target];
    const tint = hex ? new Color(hex) : white;
    for (const material of materials) tintMaterial(material, tint);
  });
}
