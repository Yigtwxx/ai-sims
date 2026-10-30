import { Color, MeshPhysicalMaterial } from 'three';

import type { AccessoryFinish } from './catalog';

/**
 * Physically based finishes for jewellery under the studio HDRI (the scene's
 * environment): polished metal, a cut stone, nacre and velvet. Stones are not
 * transmissive (that costs a second scene pass every frame); their facets and
 * a strong environment reflection make them sparkle.
 */
export type JewelleryFinish = AccessoryFinish | 'steel';

/** A metal setting for stones and pearls: polished steel, or the piece's metal. */
export const SETTING_STEEL = '#cfd3d8';

function create(finish: JewelleryFinish, hex: string): MeshPhysicalMaterial {
  const color = new Color(hex);
  switch (finish) {
    case 'metal':
    case 'steel':
      return Object.assign(new MeshPhysicalMaterial({ color, metalness: 1, roughness: 0.26 }), {
        envMapIntensity: 1.15,
      });
    case 'gem':
      return Object.assign(
        new MeshPhysicalMaterial({
          color,
          metalness: 0,
          roughness: 0.02,
          ior: 2.4,
          specularIntensity: 1,
          clearcoat: 1,
          clearcoatRoughness: 0,
          iridescence: 0.35,
          iridescenceIOR: 1.8,
          flatShading: true,
        }),
        { envMapIntensity: 2.6 },
      );
    case 'pearl':
      return Object.assign(
        new MeshPhysicalMaterial({
          color,
          metalness: 0,
          roughness: 0.28,
          clearcoat: 1,
          clearcoatRoughness: 0.12,
          sheen: 0.6,
          sheenRoughness: 0.35,
          sheenColor: new Color('#ffe9ee'),
          iridescence: 0.55,
          iridescenceIOR: 1.6,
          iridescenceThicknessRange: [200, 500],
        }),
        { envMapIntensity: 1.2 },
      );
    case 'velvet':
      return new MeshPhysicalMaterial({
        color,
        metalness: 0,
        roughness: 0.85,
        sheen: 1,
        sheenRoughness: 0.45,
        sheenColor: color.clone().lerp(new Color(1, 1, 1), 0.35),
      });
  }
}

/** Materials of one character's jewellery: shared per finish and colour, freed together. */
export class JewelleryMaterials {
  private readonly cache = new Map<string, MeshPhysicalMaterial>();

  get(finish: JewelleryFinish, hex: string): MeshPhysicalMaterial {
    const key = `${finish}:${hex}`;
    let material = this.cache.get(key);
    if (!material) {
      material = create(finish, hex);
      material.name = `jewellery_${key}`;
      this.cache.set(key, material);
    }
    return material;
  }

  dispose(): void {
    for (const material of this.cache.values()) material.dispose();
    this.cache.clear();
  }
}
