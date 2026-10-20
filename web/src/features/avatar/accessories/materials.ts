import {
  BackSide,
  Color,
  CustomBlending,
  DoubleSide,
  FrontSide,
  MeshPhysicalMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  type Material,
  type Texture,
} from 'three';

/**
 * Physically based materials for jewellery. The stage HDRI is bound to every
 * material explicitly (not via scene.environment) so each finish can set its
 * own reflection strength: metals and stones need far more than the scene
 * default to read as jewellery next to flat MToon shading.
 */

export interface GemMaterials {
  /** Inner facets seen through the stone: bright, coloured reflections. */
  back: MeshPhysicalMaterial;
  /** Outer facets: tint plus crisp specular highlights. */
  front: MeshPhysicalMaterial;
}

interface EnvBinding {
  material: MeshPhysicalMaterial;
  intensity: number;
}

const _white = new Color(1, 1, 1);

function linearLuminance(color: Color): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

/** Shared materials of one accessory rig; created on demand, disposed together. */
export class MaterialKit {
  private readonly cache = new Map<string, Material | GemMaterials>();
  private readonly bindings: EnvBinding[] = [];
  private environment: Texture | null = null;

  private remember<T extends Material | GemMaterials>(key: string, create: () => T): T {
    const cached = this.cache.get(key);
    if (cached) return cached as T;
    const value = create();
    this.cache.set(key, value);
    return value;
  }

  private physical(
    intensity: number,
    params: ConstructorParameters<typeof MeshPhysicalMaterial>[0],
  ): MeshPhysicalMaterial {
    const material = new MeshPhysicalMaterial(params);
    material.envMapIntensity = intensity;
    if (this.environment) material.envMap = this.environment;
    this.bindings.push({ material, intensity });
    return material;
  }

  /** Polished (or brushed) metal; dark metals get a clear coat so they stay glossy. */
  metal(hex: string, finish: 'polished' | 'brushed' = 'polished'): MeshPhysicalMaterial {
    return this.remember(`metal:${hex}:${finish}`, () => {
      const color = new Color(hex);
      const dark = linearLuminance(color) < 0.08;
      return this.physical(dark ? 1.4 : 1.9, {
        name: `accessory-metal-${hex}`,
        color,
        metalness: 1,
        roughness: finish === 'polished' ? (dark ? 0.24 : 0.17) : 0.34,
        clearcoat: dark ? 1 : 0,
        clearcoatRoughness: 0.08,
      });
    });
  }

  /** Faceted stone, rendered as inner (back-face) and outer (front-face) shells. */
  gem(hex: string): GemMaterials {
    return this.remember(`gem:${hex}`, () => {
      const color = new Color(hex);
      const clear = linearLuminance(color) > 0.7;
      // Inner facets: bright tinted mirrors standing in for refraction and fire.
      const back = this.physical(clear ? 2.6 : 2.2, {
        name: `accessory-gem-back-${hex}`,
        color: color.clone().lerp(_white, clear ? 0 : 0.12),
        metalness: clear ? 0.65 : 0.45,
        roughness: 0.04,
        side: BackSide,
        flatShading: true,
        iridescence: clear ? 1 : 0.35,
        iridescenceIOR: 1.6,
        iridescenceThicknessRange: [180, 640],
      });
      const front = this.physical(2.4, {
        name: `accessory-gem-front-${hex}`,
        color,
        metalness: 0,
        roughness: 0.02,
        ior: clear ? 2.4 : 1.77,
        specularIntensity: 1,
        transparent: true,
        opacity: clear ? 0.32 : 0.62,
        depthWrite: false,
        side: FrontSide,
        flatShading: true,
        iridescence: clear ? 0.6 : 0.2,
        iridescenceIOR: 1.5,
        iridescenceThicknessRange: [200, 500],
      });
      return { back, front };
    });
  }

  /** Nacre: soft lustre with a thin-film orient and a pink-green sheen. */
  pearl(hex: string): MeshPhysicalMaterial {
    return this.remember(`pearl:${hex}`, () => {
      // Pearls are tinted, never pure white or saturated: blend toward cream nacre.
      const tint = new Color(hex);
      const color = new Color('#f4ece2').multiply(tint).lerp(tint, 0.25);
      return this.physical(1.35, {
        name: `accessory-pearl-${hex}`,
        color,
        metalness: 0,
        roughness: 0.22,
        clearcoat: 1,
        clearcoatRoughness: 0.12,
        sheen: 0.7,
        sheenRoughness: 0.35,
        sheenColor: new Color('#ffd9e6'),
        iridescence: 0.55,
        iridescenceIOR: 1.35,
        iridescenceThicknessRange: [220, 520],
      });
    });
  }

  /** Velvet: deep body colour with a bright grazing sheen. */
  velvet(hex: string): MeshPhysicalMaterial {
    return this.remember(`velvet:${hex}`, () => {
      const color = new Color(hex);
      return this.physical(0.5, {
        name: `accessory-velvet-${hex}`,
        color,
        metalness: 0,
        roughness: 0.92,
        sheen: 1,
        sheenRoughness: 0.42,
        sheenColor: color.clone().lerp(_white, 0.45),
        side: DoubleSide,
      });
    });
  }

  /** Satin ribbon or silk petals: soft anisotropic highlight along the weave. */
  satin(hex: string): MeshPhysicalMaterial {
    return this.remember(`satin:${hex}`, () => {
      const color = new Color(hex);
      return this.physical(0.95, {
        name: `accessory-satin-${hex}`,
        color,
        metalness: 0,
        roughness: 0.36,
        sheen: 0.6,
        sheenRoughness: 0.3,
        sheenColor: color.clone().lerp(_white, 0.55),
        anisotropy: 0.65,
        clearcoat: 0.25,
        clearcoatRoughness: 0.35,
        side: DoubleSide,
      });
    });
  }

  /** Glossy enamel or lacquer (watch dials, clip inlays). */
  enamel(hex: string, roughness = 0.28): MeshPhysicalMaterial {
    return this.remember(`enamel:${hex}:${roughness}`, () =>
      this.physical(1.1, {
        name: `accessory-enamel-${hex}`,
        color: new Color(hex),
        metalness: 0,
        roughness,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
      }),
    );
  }

  /**
   * Clear spectacle lens: adds reflections over the eyes and absorbs almost
   * nothing (premultiplied blending: colour is added, the background is only
   * dimmed by the small opacity).
   */
  clearLens(): MeshPhysicalMaterial {
    return this.remember('lens:clear', () => {
      const material = this.physical(1.7, {
        name: 'accessory-lens-clear',
        color: new Color(0, 0, 0),
        metalness: 0,
        roughness: 0.03,
        ior: 1.6,
        specularIntensity: 1,
        transparent: true,
        opacity: 0.07,
        depthWrite: false,
      });
      material.blending = CustomBlending;
      material.blendSrc = OneFactor;
      material.blendDst = OneMinusSrcAlphaFactor;
      return material;
    });
  }

  /** Tinted sunglass lens with a vertical gradient (vertex alpha). */
  tintedLens(hex: string): MeshPhysicalMaterial {
    return this.remember(`lens:${hex}`, () =>
      this.physical(2.2, {
        name: `accessory-lens-${hex}`,
        color: new Color(hex),
        metalness: 0.1,
        roughness: 0.05,
        ior: 1.6,
        specularIntensity: 1,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        transparent: true,
        opacity: 1,
        vertexColors: true,
        depthWrite: false,
      }),
    );
  }

  /** Bind the stage environment map (once it exists) to every material. */
  bindEnvironment(environment: Texture | null): void {
    if (environment === this.environment) return;
    this.environment = environment;
    for (const { material, intensity } of this.bindings) {
      material.envMap = environment;
      material.envMapIntensity = intensity;
      material.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const value of this.cache.values()) {
      if ('front' in value) {
        value.front.dispose();
        value.back.dispose();
      } else value.dispose();
    }
    this.cache.clear();
    this.bindings.length = 0;
  }
}
