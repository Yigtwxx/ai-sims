import {
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Material,
  type Texture,
  type WebGLRenderer,
} from 'three';

import type { GroomSlot } from '@/lib/assets/manifest';

import { hairColor } from './hairColor';
import type { HairLook } from './hairMaterial';

/**
 * Groom density on the skin, in head UV space (density in A). MetaHuman's skin
 * darkens and tints the scalp, brows and beard area with it, which is what
 * makes a hairline and a brow read as hair growing from skin rather than cards
 * on top. Hair and facial hair use the converter's `density` map (smooth, from
 * the cards' root UVs, every groom has one): Unreal's `baked` map is strand
 * detail averaging ~0.13 and missing for half the grooms, so the scalp showed
 * pink through the crown. Brows keep the strand detail of `baked`. The four
 * slots are packed into one RGBA texture so the head skin spends a single
 * texture unit on them.
 *
 * Painted grooms (stubble, buzz cuts: strands only in Unreal, no cards) have
 * just their `baked` map; in their slot the skin is painted in the hair colour
 * by that coverage instead of tinted, and the pack is 2048 with mipmaps so the
 * strands stay crisp up close and calm at a distance.
 */

export const DENSITY_SLOTS = ['hair', 'eyebrows', 'beard', 'mustache'] as const;

/** How strongly full density tints the skin, per slot (hair .. mustache). */
export const DENSITY_STRENGTH = new Vector4(0.85, 0.45, 0.6, 0.6);

/** How opaque a painted groom's strands are on the skin, per slot (no painted brows). */
export const PAINT_STRENGTH = new Vector4(1, 0, 0.95, 0.95);

/** Pack size: card grooms only need the smooth cover; painted strands need detail. */
const DENSITY_SIZE = 1024;
const PAINT_SIZE = 2048;

/** Density map preferred per slot: strand detail for brows, smooth cover for the rest. */
const DENSITY_ROLES: Record<(typeof DENSITY_SLOTS)[number], readonly string[]> = {
  hair: ['density', 'baked'],
  eyebrows: ['baked', 'density'],
  beard: ['density', 'baked'],
  mustache: ['density', 'baked'],
};

export interface GroomDensityUniforms {
  skinGroomDensity: { value: Texture | null };
  /** Per-slot strength; zero where the slot has no density (or no groom). */
  skinGroomStrength: { value: Vector4 };
  /** Linear colour the skin is multiplied towards (from the hair colour). */
  skinGroomTint: { value: Vector3 };
  /** Per-slot opacity of painted strands; zero for card grooms. */
  skinGroomPaint: { value: Vector4 };
  /** Linear colour of painted strands (the hair colour itself). */
  skinGroomColor: { value: Vector3 };
}

export function createGroomDensityUniforms(): GroomDensityUniforms {
  return {
    skinGroomDensity: { value: null },
    skinGroomStrength: { value: new Vector4() },
    skinGroomTint: { value: new Vector3(1, 1, 1) },
    skinGroomPaint: { value: new Vector4() },
    skinGroomColor: { value: new Vector3(1, 1, 1) },
  };
}

/**
 * Skin tint for a hair look: the hair colour lifted towards white, so black
 * hair darkens the scalp a lot and blond hair only warms it.
 */
export function densityTint(look: HairLook): Vector3 {
  const [r, g, b] = hairColor(look.melanin, look.redness, look.dye);
  return new Vector3(r ** 0.35, g ** 0.35, b ** 0.35);
}

/** Colour of painted strands: the hair colour, a touch darker for the shade between them. */
export function paintColor(look: HairLook): Vector3 {
  const [r, g, b] = hairColor(look.melanin, look.redness, look.dye);
  return new Vector3(r, g, b).multiplyScalar(0.85);
}

/**
 * Copies the A channel of up to four baked textures into R, G, B, A of one
 * target; with painted strands in it, at a higher size and with mipmaps.
 */
export function packGroomDensity(
  renderer: WebGLRenderer,
  layers: readonly (Texture | null)[],
  painted = false,
): WebGLRenderTarget {
  const size = painted ? PAINT_SIZE : DENSITY_SIZE;
  const target = new WebGLRenderTarget(size, size, {
    format: RGBAFormat,
    type: UnsignedByteType,
    minFilter: painted ? LinearMipmapLinearFilter : LinearFilter,
    magFilter: LinearFilter,
    generateMipmaps: painted,
    depthBuffer: false,
  });
  const material = new ShaderMaterial({
    uniforms: {
      layer0: { value: layers[0] ?? null },
      layer1: { value: layers[1] ?? null },
      layer2: { value: layers[2] ?? null },
      layer3: { value: layers[3] ?? null },
      present: {
        value: new Vector4(...[0, 1, 2, 3].map((i) => (layers[i] ? 1 : 0))),
      },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4( position.xy, 0.0, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D layer0;
      uniform sampler2D layer1;
      uniform sampler2D layer2;
      uniform sampler2D layer3;
      uniform vec4 present;
      varying vec2 vUv;
      void main() {
        gl_FragColor = present * vec4(
          texture2D( layer0, vUv ).a,
          texture2D( layer1, vUv ).a,
          texture2D( layer2, vUv ).a,
          texture2D( layer3, vUv ).a
        );
      }`,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(quad, new OrthographicCamera());
  renderer.setRenderTarget(previous);
  quad.geometry.dispose();
  material.dispose();
  return target;
}

function densityUniformsOf(material: Material): GroomDensityUniforms | null {
  return (material.userData.groomDensityUniforms as GroomDensityUniforms | null) ?? null;
}

const perSlot = (value: (i: number) => number) =>
  [0, 1, 2, 3].map(value) as [number, number, number, number];

/**
 * Puts a packed density texture on the skins that take one (the head). `files`
 * says which slots have density and `painted` which of them are painted
 * grooms; null clears it.
 */
export function setGroomDensity(
  materials: readonly Material[],
  density: Texture | null,
  files: readonly (string | null)[],
  look: HairLook | undefined,
  painted: readonly boolean[] = [],
): void {
  const has = (i: number) => Boolean(density && files[i]);
  for (const material of materials) {
    const uniforms = densityUniformsOf(material);
    if (!uniforms) continue;
    uniforms.skinGroomDensity.value = density;
    uniforms.skinGroomStrength.value.set(
      ...perSlot((i) => (has(i) && !painted[i] ? DENSITY_STRENGTH.getComponent(i) : 0)),
    );
    uniforms.skinGroomPaint.value.set(
      ...perSlot((i) => (has(i) && painted[i] ? PAINT_STRENGTH.getComponent(i) : 0)),
    );
    if (look) {
      uniforms.skinGroomTint.value.copy(densityTint(look));
      uniforms.skinGroomColor.value.copy(paintColor(look));
    }
  }
}

/** Follows a hair colour change without repacking. */
export function setGroomTint(materials: readonly Material[], look: HairLook): void {
  for (const material of materials) {
    const uniforms = densityUniformsOf(material);
    uniforms?.skinGroomTint.value.copy(densityTint(look));
    uniforms?.skinGroomColor.value.copy(paintColor(look));
  }
}

interface DensitySource {
  groom: { slot: GroomSlot; textures: Record<string, string>; painted?: string };
}

/** Density file of the groom worn in each slot (DENSITY_SLOTS order); a painted groom's map. */
export function densityFiles(grooms: readonly DensitySource[]): (string | null)[] {
  return DENSITY_SLOTS.map((slot) => {
    const groom = grooms.find((wear) => wear.groom.slot === slot)?.groom;
    if (groom?.painted) return groom.painted;
    const role = DENSITY_ROLES[slot].find((name) => groom?.textures[name]);
    return role ? groom!.textures[role]! : null;
  });
}

/** Whether the groom worn in each slot is painted on the skin (DENSITY_SLOTS order). */
export function paintedSlots(grooms: readonly DensitySource[]): boolean[] {
  return DENSITY_SLOTS.map((slot) =>
    Boolean(grooms.find((wear) => wear.groom.slot === slot)?.groom.painted),
  );
}
