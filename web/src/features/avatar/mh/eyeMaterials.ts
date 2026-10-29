import {
  Color,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MultiplyBlending,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type Texture,
} from 'three';

/**
 * Eye materials for converted MetaHuman heads. The converter leaves the eye
 * occlusion shell, tear line and caruncle fully transparent; without the
 * occlusion the eyes look pasted on. The tear line stays hidden: a glossy
 * film there read as a white rim on the lower lid at any strength we tried. Values follow MI_eye_occlusion_unified from the
 * materials dump; its graph is not dumped, so the falloff below is our reading
 * of the parameter names: each `*Shadow` darkens inward from its UV edge
 * (radius, hardness = solid share), each `*ShadowBorder` fades the result back
 * to nothing right at that edge, where the shell meets the lids, so its rim
 * never shows on the skin.
 *
 * Shell UVs (measured on the head GLB): u = 0 outer corner .. 1 inner corner,
 * v = 0 top .. 1 bottom, mirrored for the right eye.
 */

export interface OcclusionSide {
  radius: number;
  hardness: number;
}

export interface EyeOcclusionTuning {
  top: OcclusionSide;
  topBorder: OcclusionSide;
  bottom: OcclusionSide;
  bottomBorder: OcclusionSide;
  inner: OcclusionSide;
  innerBorder: OcclusionSide;
  outer: OcclusionSide;
  outerBorder: OcclusionSide;
  tint: Color;
  /** Darkening at full occlusion (0 none .. 1 black). */
  strength: number;
}

export const MH_EYE_OCCLUSION: EyeOcclusionTuning = {
  top: { radius: 0.7504, hardness: 0.4864 },
  topBorder: { radius: 0.1844, hardness: 0 },
  bottom: { radius: 0, hardness: 0 },
  bottomBorder: { radius: 0.05, hardness: 0 },
  inner: { radius: 0.2744, hardness: 0.708 },
  innerBorder: { radius: 0.2044, hardness: 0.3824 },
  outer: { radius: 0, hardness: 0 },
  outerBorder: { radius: 0.102, hardness: 0 },
  tint: new Color(0.901, 0.901, 0.901),
  // Chosen on the dev bench against the unshaded eye: 0.15 barely reads, 0.4 hides the iris top.
  strength: 0.3,
};

/** CPU mirror of the shader falloff, for tests and tuning: 1 at the edge, 0 past `radius`. */
export function sideOcclusion(distance: number, { radius, hardness }: OcclusionSide): number {
  if (radius <= 0) return 0;
  const solid = radius * hardness;
  if (distance <= solid) return 1;
  if (distance >= radius) return 0;
  const t = (distance - solid) / (radius - solid);
  return 1 - t * t * (3 - 2 * t);
}

/** Occlusion 0..1 at a shell UV. */
export function eyeOcclusion(u: number, v: number, tuning = MH_EYE_OCCLUSION): number {
  const shadow = Math.max(
    sideOcclusion(v, tuning.top),
    sideOcclusion(1 - v, tuning.bottom),
    sideOcclusion(1 - u, tuning.inner),
    sideOcclusion(u, tuning.outer),
  );
  const rim =
    (1 - sideOcclusion(v, tuning.topBorder)) *
    (1 - sideOcclusion(1 - v, tuning.bottomBorder)) *
    (1 - sideOcclusion(1 - u, tuning.innerBorder)) *
    (1 - sideOcclusion(u, tuning.outerBorder));
  return shadow * rim;
}

const sideUniform = (side: OcclusionSide) => ({ value: [side.radius, side.hardness] });

const OCCLUSION_GLSL = /* glsl */ `
uniform vec2 occTop; uniform vec2 occTopBorder;
uniform vec2 occBottom; uniform vec2 occBottomBorder;
uniform vec2 occInner; uniform vec2 occInnerBorder;
uniform vec2 occOuter; uniform vec2 occOuterBorder;
uniform vec3 occTint;
uniform float occStrength;
float occSide( float d, vec2 side ) {
  if ( side.x <= 0.0 ) return 0.0;
  return 1.0 - smoothstep( side.x * side.y, side.x, d );
}
`;

export function createEyeOcclusionMaterial(tuning = MH_EYE_OCCLUSION): MeshBasicMaterial {
  const material = new MeshBasicMaterial({
    name: 'eyeshell_occlusion',
    transparent: true,
    depthWrite: false,
    blending: MultiplyBlending,
    premultipliedAlpha: true,
  });
  material.defines = { USE_UV: '' };
  const uniforms = {
    occTop: sideUniform(tuning.top),
    occTopBorder: sideUniform(tuning.topBorder),
    occBottom: sideUniform(tuning.bottom),
    occBottomBorder: sideUniform(tuning.bottomBorder),
    occInner: sideUniform(tuning.inner),
    occInnerBorder: sideUniform(tuning.innerBorder),
    occOuter: sideUniform(tuning.outer),
    occOuterBorder: sideUniform(tuning.outerBorder),
    occTint: { value: tuning.tint },
    occStrength: { value: tuning.strength },
  };
  // Live-tunable from the dev bench; the shader reads these objects directly.
  material.userData.occlusionUniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${OCCLUSION_GLSL}`)
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        /* glsl */ `
        float occShadow = max(
          max( occSide( vUv.y, occTop ), occSide( 1.0 - vUv.y, occBottom ) ),
          max( occSide( 1.0 - vUv.x, occInner ), occSide( vUv.x, occOuter ) )
        );
        float occRim = ( 1.0 - occSide( vUv.y, occTopBorder ) ) * ( 1.0 - occSide( 1.0 - vUv.y, occBottomBorder ) )
          * ( 1.0 - occSide( 1.0 - vUv.x, occInnerBorder ) ) * ( 1.0 - occSide( vUv.x, occOuterBorder ) );
        float occ = occShadow * occRim;
        vec4 diffuseColor = vec4( mix( vec3( 1.0 ), occTint, occ ) * ( 1.0 - occ * occStrength ), 1.0 );
        `,
      );
  };
  material.customProgramCacheKey = () => 'mh-eye-occlusion-v2';
  return material;
}

type Rgb = [number, number, number];

/**
 * Iris ring in eyeball UV, as a distance from the centre (measured on the
 * 2048 px DCC eye maps): the pupil ends by 0.04, the iris runs to 0.13 and a
 * dark limbus ring to 0.15, where the sclera starts. Each pair is a fade.
 */
export const IRIS_UV = { pupil: [0.035, 0.05], limbus: [0.13, 0.15] } as const;
/** Share of the tint in the iris; the rest keeps the iris's own hue. */
export const IRIS_TINT_STRENGTH = 0.85;
/**
 * Chroma kept from the picked colour. At full chroma blue and green irises read
 * as coloured contact lenses under the studio light; brown and grey barely move.
 */
export const IRIS_TINT_CHROMA = 0.75;
const LUMA: Rgb = [0.2126, 0.7152, 0.0722];
const luma = ([r, g, b]: Rgb) => r * LUMA[0] + g * LUMA[1] + b * LUMA[2];
/** Caps a texel's brightness against the iris average, so a glint is not blown out. */
const IRIS_DETAIL_MAX = 3;

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
};

/** CPU mirror of the shader's iris mask at a UV distance from the eyeball's centre. */
export function irisMask(radius: number): number {
  return (
    smoothstep(IRIS_UV.pupil[0], IRIS_UV.pupil[1], radius) *
    (1 - smoothstep(IRIS_UV.limbus[0], IRIS_UV.limbus[1], radius))
  );
}

/**
 * CPU mirror of the shader tint (linear light): the iris takes the tint at its
 * own average brightness (`reference`) and keeps its fibres as brightness
 * ratios, so a brown iris tinted blue reads as a blue iris, not a blue film.
 */
export function tintIris(texel: Rgb, tint: Rgb, reference: number, mask: number): Rgb {
  const detail = Math.min(luma(texel) / reference, IRIS_DETAIL_MAX);
  const muted = muteTint(tint);
  const k = mask * IRIS_TINT_STRENGTH;
  return [0, 1, 2].map((c) => texel[c]! + (muted[c]! * detail - texel[c]!) * k) as Rgb;
}

/** The picked colour at IRIS_TINT_CHROMA, same brightness. */
export function muteTint(tint: Rgb): Rgb {
  const grey = luma(tint);
  return tint.map((c) => grey + (c - grey) * IRIS_TINT_CHROMA) as Rgb;
}

export interface IrisTint {
  /** Linear colour. */
  color: Rgb;
  /** Linear luminance of the worn iris's ring (its manifest swatch). */
  reference: number;
}

const IRIS_TINT_GLSL = /* glsl */ `
uniform vec3 irisTint;
uniform float irisTintAmount;
uniform float irisReference;
`;

/**
 * Eyeball with a glossy cornea over a softer iris and sclera: the clearcoat
 * lobe carries the sharp catch-lights, the base lobe stays diffuse-looking.
 * The iris can be recoloured (setIrisTint) without new maps.
 */
export function createEyeballMaterial(source: MeshStandardMaterial): MeshPhysicalMaterial {
  const material = new MeshPhysicalMaterial({
    name: `${source.name}_eyeball`,
    map: source.map,
    normalMap: source.normalMap,
    normalScale: source.normalScale.clone(),
    roughness: 0.32,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    ior: 1.376,
  });
  const uniforms = {
    irisTint: { value: new Color(1, 1, 1) },
    irisTintAmount: { value: 0 },
    irisReference: { value: 1 },
  };
  material.userData.irisUniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${IRIS_TINT_GLSL}`)
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
        #ifdef USE_MAP
          float irisR = distance( vMapUv, vec2( 0.5 ) );
          float irisMask = smoothstep( ${IRIS_UV.pupil[0]}, ${IRIS_UV.pupil[1]}, irisR )
            * ( 1.0 - smoothstep( ${IRIS_UV.limbus[0]}, ${IRIS_UV.limbus[1]}, irisR ) );
          float irisLuma = dot( diffuseColor.rgb, vec3( ${LUMA.join(', ')} ) );
          vec3 irisTinted = irisTint * min( irisLuma / irisReference, ${IRIS_DETAIL_MAX.toFixed(1)} );
          diffuseColor.rgb = mix( diffuseColor.rgb, irisTinted, irisMask * irisTintAmount );
        #endif
        `,
      );
  };
  material.customProgramCacheKey = () => 'mh-eyeball-tint-v1';
  return material;
}

/** Recolours the iris of the eyeball materials (null: its own colour); needs no reload. */
export function setIrisTint(materials: readonly Material[], tint: IrisTint | null): void {
  for (const material of materials) {
    const uniforms = material.userData.irisUniforms as
      | {
          irisTint: { value: Color };
          irisTintAmount: { value: number };
          irisReference: { value: number };
        }
      | undefined;
    if (!uniforms) continue;
    uniforms.irisTintAmount.value = tint ? IRIS_TINT_STRENGTH : 0;
    if (!tint) continue;
    uniforms.irisTint.value.setRGB(...muteTint(tint.color));
    uniforms.irisReference.value = Math.max(tint.reference, 1e-4);
  }
}

/** Replaces the eye materials of an assembled character; returns them for disposal. */
export function applyEyeMaterials(root: Object3D): Material[] {
  const created: Material[] = [];
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const source = mesh.material as MeshStandardMaterial;
    let next: Material | null = null;
    if (source.name === 'eyeshell') next = createEyeOcclusionMaterial();
    else if (source.name === 'eyeLeft' || source.name === 'eyeRight') {
      next = createEyeballMaterial(source);
    }
    if (!next) return;
    mesh.userData.mhSourceMaterial = source;
    mesh.material = next;
    // Drawn after the eyeballs it darkens.
    if (source.name === 'eyeshell') mesh.renderOrder = 1;
    created.push(next);
  });
  return created;
}

/** Puts an iris set on the eyeball materials created by applyEyeMaterials. */
export function bindIrisTextures(
  materials: readonly Material[],
  textures: { color: Texture; normal: Texture | null },
): void {
  for (const material of materials) {
    if (!material.name.endsWith('_eyeball')) continue;
    const eyeball = material as MeshPhysicalMaterial;
    eyeball.map = textures.color;
    eyeball.normalMap = textures.normal;
    // No tangents in our GLBs: glTF normal maps need y flipped (as GLTFLoader does).
    eyeball.normalScale.set(1, -1);
    eyeball.needsUpdate = true;
  }
}
