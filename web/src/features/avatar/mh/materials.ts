import {
  Color,
  MeshPhysicalMaterial,
  RepeatWrapping,
  ShaderChunk,
  TextureLoader,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type Texture,
} from 'three';

import { BODY_HIDDEN } from './garments';
import { createGroomDensityUniforms } from './groomDensity';
import { WRINKLE_MASK_LAYERS, WRINKLE_WEIGHT_COUNT } from './wrinkles';

/**
 * Material pass for converted MetaHuman GLBs. The converter writes plain glTF
 * PBR materials; skin gets a physical material with the look of MetaHuman's
 * skin shader where it matters most at web cost:
 *  - wrapped, red-tinted diffuse past the terminator (subsurface scattering),
 *  - per-pixel specular level from the SRMF map's red channel (the glTF
 *    metallic-roughness slot already carries roughness in green),
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
  /** UV repeats of the micro normal across the head / body atlas. */
  microTiling: number;
  microStrength: number;
  sheen: number;
  /** Blend wrinkle normal maps by region weights (head only). */
  wrinkles: boolean;
  /** Tint the skin under hair, brows and beard by groom density (head only). */
  groomDensity: boolean;
  /** Discard skin under worn garments by the BODY_HIDDEN vertex attribute (body only). */
  bodyHide: boolean;
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
};

export const BODY_SKIN: SkinTuning = {
  ...HEAD_SKIN,
  microTiling: 36,
  microStrength: 0.3,
  wrinkles: false,
  groomDensity: false,
  bodyHide: true,
};

const DIFFUSE_LINE =
  'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );';
const SPECULAR_MAP_LINE =
  'specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;';
const F90_LINE = 'material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );';
const NORMAL_SCALE_LINE = 'mapN.xy *= normalScale;';

const SCATTER = /* glsl */ `
  float skinWrapNL = saturate( ( dot( geometryNormal, directLight.direction ) + skinWrap ) / ( 1.0 + skinWrap ) );
  vec3 skinScatter = skinScatterColor * max( skinWrapNL - dotNL, 0.0 ) * directLight.color;
  reflectedLight.directDiffuse += ( irradiance + skinScatter ) * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
`;
// SRMF red is Unreal's "Specular" (0.5 = the default F0 of 0.04); the cavity map
// takes the specular out of pores and creases (specular occlusion).
const SPECULAR_FROM_RED = /* glsl */ `
  specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).r * 2.0;
  specularIntensityFactor *= mix( 1.0, texture2D( skinCavity, vSpecularIntensityMapUv ).r, skinCavityStrength );
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
#endif
`;
// Skin under hair, brows and beard takes on the hair colour (see ./groomDensity.ts).
const GROOM_DENSITY = /* glsl */ `
#if defined( MH_GROOM_DENSITY ) && defined( USE_MAP )
  float groomCover = saturate( dot( texture2D( skinGroomDensity, vMapUv ), skinGroomStrength ) );
  diffuseColor.rgb *= mix( vec3( 1.0 ), skinGroomTint, groomCover );
#endif
`;

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
    ShaderChunk.lights_physical_fragment.includes(SPECULAR_MAP_LINE) &&
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
    roughnessMap: source.roughnessMap,
    roughness: 1,
    metalness: 0,
    // Same SRMF texture: red becomes the specular level in the patched shader.
    specularIntensityMap: source.roughnessMap,
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
    skinCavity: { value: null as Texture | null },
    skinCavityStrength: { value: 0 },
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
  material.defines = {
    ...(wrinkles ? { MH_WRINKLES: '' } : {}),
    ...(density ? { MH_GROOM_DENSITY: '' } : {}),
    ...(tuning.bodyHide ? { MH_BODY_HIDE: '' } : {}),
  };
  material.userData.skinUniforms = uniforms;
  material.userData.wrinkleUniforms = wrinkles;
  material.userData.groomDensityUniforms = density;
  material.userData.skinTuning = tuning;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, wrinkles ?? {}, density ?? {});
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
          'uniform sampler2D skinCavity;',
          'uniform float skinCavityStrength;',
          GROOM_DENSITY_PARS,
          BODY_HIDE_FRAGMENT_PARS,
        ].join('\n'),
      )
      .replace('#include <map_fragment>', `#include <map_fragment>\n${GROOM_DENSITY}`)
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
        ShaderChunk.lights_physical_fragment
          .replace(SPECULAR_MAP_LINE, SPECULAR_FROM_RED)
          .replace(F90_LINE, F90_CLAMPED),
      )
      .replace(
        '#include <normal_fragment_maps>',
        ShaderChunk.normal_fragment_maps.replace(NORMAL_SCALE_LINE, MICRO_NORMAL),
      );
  };
  material.customProgramCacheKey = () =>
    `mh-skin-v5${wrinkles ? '-wrinkles' : ''}${density ? '-density' : ''}${tuning.bodyHide ? '-hide' : ''}`;
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
