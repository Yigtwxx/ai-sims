import {
  LinearFilter,
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
 * Groom density on the skin. Each groom ships a "baked" texture in head UV
 * space (Unreal's baked groom textures: strand flow in RGB, density in A).
 * MetaHuman's skin darkens and tints the scalp, brows and beard area with it,
 * which is what makes a hairline and a brow read as hair growing from skin
 * rather than cards on top. The densities of the four slots are packed into
 * one RGBA texture so the head skin spends a single texture unit on them.
 */

export const DENSITY_SLOTS = ['hair', 'eyebrows', 'beard', 'mustache'] as const;

/** How strongly full density tints the skin, per slot (hair .. mustache). */
export const DENSITY_STRENGTH = new Vector4(0.55, 0.45, 0.6, 0.6);

export interface GroomDensityUniforms {
  skinGroomDensity: { value: Texture | null };
  /** Per-slot strength; zero where the slot has no density (or no groom). */
  skinGroomStrength: { value: Vector4 };
  /** Linear colour the skin is multiplied towards (from the hair colour). */
  skinGroomTint: { value: Vector3 };
}

export function createGroomDensityUniforms(): GroomDensityUniforms {
  return {
    skinGroomDensity: { value: null },
    skinGroomStrength: { value: new Vector4() },
    skinGroomTint: { value: new Vector3(1, 1, 1) },
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

/** Copies the A channel of up to four baked textures into R, G, B, A of one target. */
export function packGroomDensity(
  renderer: WebGLRenderer,
  layers: readonly (Texture | null)[],
  size = 1024,
): WebGLRenderTarget {
  const target = new WebGLRenderTarget(size, size, {
    format: RGBAFormat,
    type: UnsignedByteType,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    generateMipmaps: false,
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

/**
 * Puts a packed density texture on the skins that take one (the head). `files`
 * says which slots have density; null clears it.
 */
export function setGroomDensity(
  materials: readonly Material[],
  density: Texture | null,
  files: readonly (string | null)[],
  look: HairLook | undefined,
): void {
  for (const material of materials) {
    const uniforms = densityUniformsOf(material);
    if (!uniforms) continue;
    uniforms.skinGroomDensity.value = density;
    uniforms.skinGroomStrength.value.set(
      ...([0, 1, 2, 3].map((i) => (density && files[i] ? DENSITY_STRENGTH.getComponent(i) : 0)) as [
        number,
        number,
        number,
        number,
      ]),
    );
    if (look) uniforms.skinGroomTint.value.copy(densityTint(look));
  }
}

/** Follows a hair colour change without repacking. */
export function setGroomTint(materials: readonly Material[], look: HairLook): void {
  for (const material of materials) {
    densityUniformsOf(material)?.skinGroomTint.value.copy(densityTint(look));
  }
}

/** Baked density file of the groom worn in each slot (DENSITY_SLOTS order). */
export function densityFiles(
  grooms: readonly { groom: { slot: GroomSlot; textures: Record<string, string> } }[],
): (string | null)[] {
  return DENSITY_SLOTS.map(
    (slot) => grooms.find((wear) => wear.groom.slot === slot)?.groom.textures.baked ?? null,
  );
}
