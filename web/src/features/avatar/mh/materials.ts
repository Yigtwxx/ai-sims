import {
  Color,
  MeshPhysicalMaterial,
  RepeatWrapping,
  ShaderChunk,
  TextureLoader,
  Vector2,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type Texture,
} from 'three';

import { BODY_HIDDEN } from './garments';
import { createGroomDensityUniforms } from './groomDensity';
import { skinToneGain } from './skinTone';
import { WRINKLE_MASK_LAYERS, WRINKLE_WEIGHT_COUNT } from './wrinkles';

/**
 * Material pass for converted MetaHuman GLBs. The converter writes plain glTF
 * PBR materials; skin gets a physical material with the look of MetaHuman's
 * skin shader where it matters most at web cost:
 *  - wrapped, red-tinted diffuse past the terminator (subsurface scattering),
 *  - per-pixel specular level from the SRMF map's red channel, read from the
 *    texel the roughness slot already fetches (roughness is its green),
 *  - a tiled micro-normal for pore detail up close,
 *  - a faint sheen for peach fuzz at grazing angles,
 *  - on the head, wrinkle normals (wm1..wm3) blended in where RigLogic's
 *    region masks are active (see ./wrinkles.ts).
 */

export interface SkinDetail {
  /** Tiled tangent-space micro normal (MetaHuman T_SkinMicroNormal, DirectX green). */
  microNormal: Texture | null;
}

export interface SkinTuning {
  /** How far light wraps past the terminator (0 = Lambert). */
  wrap: number;
  /** Tint and strength of the light that scatters back (linear RGB). */
  scatter: Color;
  /**
   * UV repeats of the micro normal across the head / body atlas. The body atlas
   * spends fewer UV units per metre (about 0.72 at the neck seam, the head about
   * 1.0), so it repeats more for pores of one size on both sides of the seam;
   * Unreal's MI_Body_Baked uses 70.
   */
  microTiling: number;
  microStrength: number;
  sheen: number;
  /** Blend wrinkle normal maps by region weights (head only). */
  wrinkles: boolean;
  /** Tint the skin under hair, brows and beard by groom density (head only). */
  groomDensity: boolean;
  /** Discard skin under worn garments by the BODY_HIDDEN vertex attribute (body only). */
  bodyHide: boolean;
  /**
   * Draw the underwear over the bare skin where no garment covers it: `cloth`
   * samples the shared cloth maps (body), `straps` the top's straps packed in
   * one map (the head, which has one sampler unit left).
   */
  underwear: 'cloth' | 'straps' | null;
}

export const HEAD_SKIN: SkinTuning = {
  wrap: 0.42,
  scatter: new Color(0.85, 0.26, 0.15),
  microTiling: 48,
  microStrength: 0.35,
  sheen: 0.1,
  wrinkles: true,
  groomDensity: true,
  bodyHide: false,
  underwear: 'straps',
};

export const BODY_SKIN: SkinTuning = {
  ...HEAD_SKIN,
  microTiling: 70,
  wrinkles: false,
  groomDensity: false,
  bodyHide: true,
  underwear: 'cloth',
};

const DIFFUSE_LINE =
  'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );';
const ROUGHNESS_TEXEL_LINE = 'vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );';
const F90_LINE = 'material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );';
const NORMAL_SCALE_LINE = 'mapN.xy *= normalScale;';

const SCATTER = /* glsl */ `
  float skinWrapNL = saturate( ( dot( geometryNormal, directLight.direction ) + skinWrap ) / ( 1.0 + skinWrap ) );
  vec3 skinScatter = skinScatterColor * max( skinWrapNL - dotNL, 0.0 ) * directLight.color;
  reflectedLight.directDiffuse += ( irradiance + skinScatter ) * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
`;
// SRMF red is Unreal's "Specular" (0.5 = the default F0 of 0.04), from the
// texel the roughness map already fetched. The DCC bake has the cavity map's
// specular occlusion in it: pores and creases are already darker there.
const SPECULAR_FROM_RED = /* glsl */ `
  #ifdef USE_ROUGHNESSMAP
  specularIntensityFactor *= texelRoughness.r * 2.0;
  #endif
`;
const F90_CLAMPED =
  'material.specularF90 = mix( min( specularIntensityFactor, 1.0 ), 1.0, metalnessFactor );';
// Wrinkle sets first (they replace the base normal regionally), then the
// whiteout blend of the tiled micro normal (DirectX green flipped to OpenGL).
const MICRO_NORMAL = /* glsl */ `
  mapN.xy *= normalScale;
  #if defined( MH_WRINKLES ) && defined( USE_NORMALMAP_TANGENTSPACE )
  if ( wrinkleActive > 0.5 ) {
    float wrinkle1 = 0.0;
    float wrinkle2 = 0.0;
    float wrinkle3 = 0.0;
    for ( int layer = 0; layer < ${WRINKLE_MASK_LAYERS.length}; layer ++ ) {
      vec4 regions = texture( wrinkleMasks, vec3( vNormalMapUv, float( layer ) ) );
      wrinkle1 += dot( regions, wrinkleWeights[ layer ] );
      wrinkle2 += dot( regions, wrinkleWeights[ ${WRINKLE_MASK_LAYERS.length} + layer ] );
      wrinkle3 += dot( regions, wrinkleWeights[ ${2 * WRINKLE_MASK_LAYERS.length} + layer ] );
    }
    mapN = mix( mapN, mhWrinkleNormal( wrinkleNormal1 ), saturate( wrinkle1 ) );
    mapN = mix( mapN, mhWrinkleNormal( wrinkleNormal2 ), saturate( wrinkle2 ) );
    mapN = mix( mapN, mhWrinkleNormal( wrinkleNormal3 ), saturate( wrinkle3 ) );
  }
  #endif
  vec3 skinMicro = texture2D( skinMicroNormal, vNormalMapUv * skinMicroTiling ).xyz * 2.0 - 1.0;
  skinMicro.y = -skinMicro.y;
  // Follow the base map's tangent-frame flip (glTF meshes without tangents use y = -1).
  skinMicro.xy *= skinMicroStrength * sign( normalScale );
  mapN = vec3( mapN.xy + skinMicro.xy, mapN.z );
`;

// Decodes a wrinkle normal exactly like three decodes the base normal map
// (only compiled when the head has a tangent-space normal map at all).
const WRINKLE_PARS = /* glsl */ `
#if defined( MH_WRINKLES ) && defined( USE_NORMALMAP_TANGENTSPACE )
uniform sampler2D wrinkleNormal1;
uniform sampler2D wrinkleNormal2;
uniform sampler2D wrinkleNormal3;
uniform sampler2DArray wrinkleMasks;
uniform vec4 wrinkleWeights[ ${WRINKLE_WEIGHT_COUNT / 4} ];
uniform float wrinkleActive;
vec3 mhWrinkleNormal( sampler2D map ) {
  vec3 n = texture2D( map, vNormalMapUv ).xyz * 2.0 - 1.0;
  #ifdef USE_PACKED_NORMALMAP
  n = vec3( n.xy, sqrt( saturate( 1.0 - dot( n.xy, n.xy ) ) ) );
  #endif
  n.xy *= normalScale;
  return n;
}
#endif
`;

const GROOM_DENSITY_PARS = /* glsl */ `
#ifdef MH_GROOM_DENSITY
uniform sampler2D skinGroomDensity;
uniform vec4 skinGroomStrength;
uniform vec3 skinGroomTint;
uniform vec4 skinGroomPaint;
uniform vec3 skinGroomColor;
#endif
`;
// Skin under hair, brows and beard takes on the hair colour; painted grooms
// (stubble, buzz cuts) are the hair itself, strand by strand (see ./groomDensity.ts).
const GROOM_DENSITY = /* glsl */ `
#if defined( MH_GROOM_DENSITY ) && defined( USE_MAP )
  vec4 groomLayers = texture2D( skinGroomDensity, vMapUv );
  float groomCover = saturate( dot( groomLayers, skinGroomStrength ) );
  diffuseColor.rgb *= mix( vec3( 1.0 ), skinGroomTint, groomCover );
  // Under painted hair the scalp between strands is shaded as in Unreal's
  // hair mask (a coarse mip of the coverage): half saturation, multiplied by
  // (0.864, 0.872, 0.9) ("Basecolor Hair Mask Hair Saturation/Multiply").
  float groomRegion = saturate( dot( texture2D( skinGroomDensity, vMapUv, 4.0 ), skinGroomPaint ) );
  vec3 groomScalp = mix( vec3( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), diffuseColor.rgb, 0.5 );
  diffuseColor.rgb = mix( diffuseColor.rgb, groomScalp * vec3( 0.864, 0.872, 0.9 ), groomRegion );
  float groomPaint = saturate( dot( groomLayers, skinGroomPaint ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, skinGroomColor, groomPaint );
#endif
`;
// Painted strands are hair, not oily scalp: Unreal's baked groom textures
// shade them at roughness 0.45-0.75 and specular 0.3-0.6 (0.5 is skin's
// default; BakedGroomTexturesRough*, *Spec*). Mid roughness, low specular.
const GROOM_ROUGHNESS = /* glsl */ `
#if defined( MH_GROOM_DENSITY ) && defined( USE_MAP )
  roughnessFactor = mix( roughnessFactor, 0.6, groomPaint );
#endif
`;
const GROOM_SPECULAR = /* glsl */ `
#if defined( MH_GROOM_DENSITY ) && defined( USE_MAP )
  specularIntensityFactor *= mix( 1.0, 0.6, groomPaint );
#endif
`;

const UNDERWEAR_PARS = /* glsl */ `
#ifdef MH_UNDERWEAR
uniform vec2 skinUnderwearShow;
#endif
#ifdef MH_UNDERWEAR_CLOTH
uniform sampler2D skinUnderwearMask;
uniform sampler2D skinUnderwearAlbedo;
uniform sampler2D skinUnderwearNormal;
uniform float skinUnderwearHasNormal;
#endif
#ifdef MH_UNDERWEAR_STRAPS
uniform sampler2D skinUnderwearStraps;
uniform float skinUnderwearHasStraps;
#endif
`;
// The body albedo is bare skin; the underwear (mask R top, G briefs) is drawn
// over it only where no garment covers that part (see setUnderwear). On the
// head, the top's straps: R the cloth's grey (sRGB), A its coverage.
const UNDERWEAR = /* glsl */ `
#ifdef MH_UNDERWEAR
  float underwear = 0.0;
  #ifdef MH_UNDERWEAR_STRAPS
  vec4 underwearStraps = vec4( 0.5, 0.5, 0.5, 0.0 );
  #endif
  #ifdef USE_MAP
  #ifdef MH_UNDERWEAR_CLOTH
  vec2 underwearCover = texture2D( skinUnderwearMask, vMapUv ).rg * skinUnderwearShow;
  underwear = max( underwearCover.r, underwearCover.g );
  vec3 underwearCloth = texture2D( skinUnderwearAlbedo, vMapUv ).rgb;
  #else
  underwearStraps = texture2D( skinUnderwearStraps, vMapUv );
  underwear = underwearStraps.a * skinUnderwearShow.x * skinUnderwearHasStraps;
  vec3 underwearCloth = sRGBTransferEOTF( vec4( underwearStraps.rrr, 1.0 ) ).rgb;
  #endif
  diffuseColor.rgb = mix( diffuseColor.rgb, underwearCloth, underwear );
  #endif
#endif
`;
// The cloth's normal (seams, folds, hems) replaces the bare skin's where it is drawn.
const UNDERWEAR_NORMAL = /* glsl */ `
  #if defined( MH_UNDERWEAR_CLOTH ) && defined( USE_NORMALMAP_TANGENTSPACE )
  if ( underwear * skinUnderwearHasNormal > 0.0 ) {
    vec3 underwearN = texture2D( skinUnderwearNormal, vNormalMapUv ).xyz * 2.0 - 1.0;
    underwearN.xy *= normalScale;
    mapN = mix( mapN, underwearN, underwear );
  }
  #endif
  #if defined( MH_UNDERWEAR_STRAPS ) && defined( USE_NORMALMAP_TANGENTSPACE )
  if ( underwear > 0.0 ) {
    vec3 strapN = vec3( underwearStraps.gb * 2.0 - 1.0, 0.0 );
    strapN.z = sqrt( saturate( 1.0 - dot( strapN.xy, strapN.xy ) ) );
    strapN.xy *= normalScale;
    mapN = mix( mapN, strapN, underwear );
  }
  #endif
`;

/** Underwear inputs of a skin; textures arrive with the skin set. */
export interface UnderwearUniforms {
  skinUnderwearMask: { value: Texture | null };
  skinUnderwearAlbedo: { value: Texture | null };
  skinUnderwearNormal: { value: Texture | null };
  /** 1 once the cloth normal is bound. */
  skinUnderwearHasNormal: { value: number };
  /** The head's packed straps (see UNDERWEAR). */
  skinUnderwearStraps: { value: Texture | null };
  /** 1 once the straps are bound (a man's skin has none). */
  skinUnderwearHasStraps: { value: number };
  /** Shown parts: x the top, y the briefs (0 or 1). */
  skinUnderwearShow: { value: Vector2 };
}

// Skin under a worn garment (see ./garments.ts): a face whose vertices are all
// covered interpolates to 1 and is dropped, so the body never pokes through.
const BODY_HIDE_VERTEX_PARS = /* glsl */ `
#ifdef MH_BODY_HIDE
attribute float ${BODY_HIDDEN};
varying float vBodyHidden;
#endif
`;
const BODY_HIDE_VERTEX = /* glsl */ `
#ifdef MH_BODY_HIDE
  vBodyHidden = ${BODY_HIDDEN};
#endif
`;
const BODY_HIDE_FRAGMENT_PARS = /* glsl */ `
#ifdef MH_BODY_HIDE
varying float vBodyHidden;
#endif
`;
const BODY_HIDE_FRAGMENT = /* glsl */ `
#ifdef MH_BODY_HIDE
  if ( vBodyHidden > 0.5 ) discard;
#endif
`;

/** Wrinkle inputs of a head skin; textures arrive asynchronously. */
export interface WrinkleUniforms {
  wrinkleNormal1: { value: Texture | null };
  wrinkleNormal2: { value: Texture | null };
  wrinkleNormal3: { value: Texture | null };
  wrinkleMasks: { value: Texture | null };
  wrinkleWeights: { value: Float32Array };
  wrinkleActive: { value: number };
}

let warned = false;
function chunksMatch(): boolean {
  const ok =
    ShaderChunk.lights_physical_pars_fragment.includes(DIFFUSE_LINE) &&
    ShaderChunk.roughnessmap_fragment.includes(ROUGHNESS_TEXEL_LINE) &&
    ShaderChunk.lights_physical_fragment.includes(F90_LINE) &&
    ShaderChunk.normal_fragment_maps.includes(NORMAL_SCALE_LINE);
  if (!ok && !warned) {
    warned = true;
    console.warn('[mh skin] three.js shader chunks changed; skin shading falls back to PBR');
  }
  return ok;
}

export function createSkinMaterial(
  source: MeshStandardMaterial,
  detail: SkinDetail,
  tuning: SkinTuning,
): MeshPhysicalMaterial {
  const material = new MeshPhysicalMaterial({
    name: `${source.name}_skin`,
    map: source.map,
    normalMap: source.normalMap,
    normalScale: source.normalScale.clone(),
    // SRMF: green is the roughness, red the specular level in the patched shader.
    roughnessMap: source.roughnessMap,
    roughness: 1,
    metalness: 0,
    specularIntensity: 1,
    sheen: tuning.sheen,
    sheenRoughness: 0.55,
    sheenColor: new Color(1, 0.86, 0.8),
  });
  if (!chunksMatch()) return material;

  const micro = detail.microNormal;
  if (micro) micro.wrapS = micro.wrapT = RepeatWrapping;
  const uniforms = {
    skinWrap: { value: tuning.wrap },
    skinScatterColor: { value: tuning.scatter },
    skinMicroNormal: { value: micro },
    skinMicroTiling: { value: tuning.microTiling },
    skinMicroStrength: { value: micro ? tuning.microStrength : 0 },
  };
  const wrinkles: WrinkleUniforms | null = tuning.wrinkles
    ? {
        wrinkleNormal1: { value: null },
        wrinkleNormal2: { value: null },
        wrinkleNormal3: { value: null },
        wrinkleMasks: { value: null },
        wrinkleWeights: { value: new Float32Array(WRINKLE_WEIGHT_COUNT) },
        wrinkleActive: { value: 0 },
      }
    : null;
  const density = tuning.groomDensity ? createGroomDensityUniforms() : null;
  const underwear: UnderwearUniforms | null = tuning.underwear
    ? {
        skinUnderwearMask: { value: null },
        skinUnderwearAlbedo: { value: null },
        skinUnderwearNormal: { value: null },
        skinUnderwearHasNormal: { value: 0 },
        skinUnderwearStraps: { value: null },
        skinUnderwearHasStraps: { value: 0 },
        skinUnderwearShow: { value: new Vector2(0, 0) },
      }
    : null;
  material.defines = {
    // Three's own (STANDARD, PHYSICAL): without PHYSICAL the shader has no
    // specular level at all, every texel at F0 0.04.
    ...material.defines,
    ...(wrinkles ? { MH_WRINKLES: '' } : {}),
    ...(density ? { MH_GROOM_DENSITY: '' } : {}),
    ...(tuning.bodyHide ? { MH_BODY_HIDE: '' } : {}),
    ...(underwear ? { MH_UNDERWEAR: '' } : {}),
    ...(tuning.underwear === 'cloth' ? { MH_UNDERWEAR_CLOTH: '' } : {}),
    ...(tuning.underwear === 'straps' ? { MH_UNDERWEAR_STRAPS: '' } : {}),
  };
  material.userData.skinUniforms = uniforms;
  material.userData.wrinkleUniforms = wrinkles;
  material.userData.groomDensityUniforms = density;
  material.userData.underwearUniforms = underwear;
  material.userData.skinTuning = tuning;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, wrinkles ?? {}, density ?? {}, underwear ?? {});
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
${BODY_HIDE_VERTEX_PARS}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
${BODY_HIDE_VERTEX}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
${BODY_HIDE_FRAGMENT}`,
      )
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'uniform float skinWrap;',
          'uniform vec3 skinScatterColor;',
          'uniform sampler2D skinMicroNormal;',
          'uniform float skinMicroTiling;',
          'uniform float skinMicroStrength;',
          GROOM_DENSITY_PARS,
          UNDERWEAR_PARS,
          BODY_HIDE_FRAGMENT_PARS,
        ].join('\n'),
      )
      .replace('#include <map_fragment>', `#include <map_fragment>\n${GROOM_DENSITY}\n${UNDERWEAR}`)
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>\n${GROOM_ROUGHNESS}`,
      )
      // After the normal map uniforms it reads (normalScale, vNormalMapUv).
      .replace(
        '#include <normalmap_pars_fragment>',
        `#include <normalmap_pars_fragment>\n${WRINKLE_PARS}`,
      )
      .replace(
        '#include <lights_physical_pars_fragment>',
        ShaderChunk.lights_physical_pars_fragment.replace(DIFFUSE_LINE, SCATTER),
      )
      .replace(
        '#include <lights_physical_fragment>',
        ShaderChunk.lights_physical_fragment.replace(
          F90_LINE,
          `${SPECULAR_FROM_RED}${GROOM_SPECULAR}${F90_CLAMPED}`,
        ),
      )
      .replace(
        '#include <normal_fragment_maps>',
        ShaderChunk.normal_fragment_maps.replace(
          NORMAL_SCALE_LINE,
          `${MICRO_NORMAL}\n${UNDERWEAR_NORMAL}`,
        ),
      );
  };
  material.customProgramCacheKey = () =>
    `mh-skin-v8${wrinkles ? '-wrinkles' : ''}${density ? '-density' : ''}${tuning.bodyHide ? '-hide' : ''}${tuning.underwear ? `-underwear-${tuning.underwear}` : ''}`;
  return material;
}

function materialsOf(mesh: Mesh): Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

/**
 * Replaces the skin materials of an assembled character (clones only: the
 * loader cache keeps the originals). Returns the created materials so the
 * caller can dispose of them on unmount.
 */
export function applySkinMaterials(root: Object3D, detail: SkinDetail): Material[] {
  const created: Material[] = [];
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    const [source] = materialsOf(mesh);
    const tuning = source?.name === 'head' ? HEAD_SKIN : source?.name === 'body' ? BODY_SKIN : null;
    if (!tuning || Array.isArray(mesh.material)) return;
    const skin = createSkinMaterial(source as MeshStandardMaterial, detail, tuning);
    // Kept for A/B checks on the dev bench.
    mesh.userData.mhSourceMaterial = source;
    mesh.material = skin;
    created.push(skin);
  });
  return created;
}

/**
 * Which underwear the body shows: the briefs unless a bottom (or one-piece)
 * covers them, the top on bodies that wear one unless a top covers it.
 */
export function setUnderwear(
  materials: readonly Material[],
  show: { top: boolean; bottom: boolean },
): void {
  for (const material of materials) {
    const uniforms = material.userData.underwearUniforms as UnderwearUniforms | null | undefined;
    uniforms?.skinUnderwearShow.value.set(show.top ? 1 : 0, show.bottom ? 1 : 0);
  }
}

/**
 * Fine tone adjustment of the worn skin set (-1 lighter .. 1 darker): a gain
 * on the albedo through the material colour, so it needs no recompile.
 */
export function setSkinTone(materials: readonly Material[], tone: number): void {
  const [r, g, b] = skinToneGain(tone);
  for (const material of materials) {
    if (material.userData.skinTuning) (material as MeshPhysicalMaterial).color.setRGB(r, g, b);
  }
}

/** Shared detail textures (renderer-owned, next to the converted assets). */
export const MICRO_NORMAL_URL = '/assets/mh/shared/skin/micro_normal.png';

let detail: Promise<SkinDetail> | null = null;

/**
 * Loads the shared skin detail once per page. A missing file is not an error:
 * skin renders without pores rather than failing the character.
 */
export function loadSkinDetail(): Promise<SkinDetail> {
  detail ??= new TextureLoader()
    .loadAsync(MICRO_NORMAL_URL)
    .then((texture) => {
      texture.wrapS = texture.wrapT = RepeatWrapping;
      texture.anisotropy = 8;
      return { microNormal: texture };
    })
    .catch(() => ({ microNormal: null }));
  return detail;
}

/** Swaps the detail textures of skin materials created earlier (no recompile). */
export function setSkinDetail(materials: readonly Material[], next: SkinDetail): void {
  for (const material of materials) {
    const uniforms = material.userData.skinUniforms as
      | { skinMicroNormal: { value: Texture | null }; skinMicroStrength: { value: number } }
      | undefined;
    const tuning = material.userData.skinTuning as SkinTuning | undefined;
    if (!uniforms || !tuning) continue;
    uniforms.skinMicroNormal.value = next.microNormal;
    uniforms.skinMicroStrength.value = next.microNormal ? tuning.microStrength : 0;
  }
}
