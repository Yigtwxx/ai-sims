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

/**
 * Material pass for converted MetaHuman GLBs. The converter writes plain glTF
 * PBR materials; skin gets a physical material with the look of MetaHuman's
 * skin shader where it matters most at web cost:
 *  - wrapped, red-tinted diffuse past the terminator (subsurface scattering),
 *  - per-pixel specular level from the SRMF map's red channel (the glTF
 *    metallic-roughness slot already carries roughness in green),
 *  - a tiled micro-normal for pore detail up close,
 *  - a faint sheen for peach fuzz at grazing angles.
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
}

export const HEAD_SKIN: SkinTuning = {
  wrap: 0.42,
  scatter: new Color(0.85, 0.26, 0.15),
  microTiling: 48,
  microStrength: 0.35,
  sheen: 0.1,
};

export const BODY_SKIN: SkinTuning = { ...HEAD_SKIN, microTiling: 36, microStrength: 0.3 };

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
// SRMF red is Unreal's "Specular" (0.5 = the default F0 of 0.04).
const SPECULAR_FROM_RED = /* glsl */ `
  specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).r * 2.0;
`;
const F90_CLAMPED =
  'material.specularF90 = mix( min( specularIntensityFactor, 1.0 ), 1.0, metalnessFactor );';
// Whiteout blend of the tiled micro normal (DirectX green flipped to OpenGL).
const MICRO_NORMAL = /* glsl */ `
  mapN.xy *= normalScale;
  vec3 skinMicro = texture2D( skinMicroNormal, vNormalMapUv * skinMicroTiling ).xyz * 2.0 - 1.0;
  skinMicro.y = -skinMicro.y;
  skinMicro.xy *= skinMicroStrength;
  mapN = vec3( mapN.xy + skinMicro.xy, mapN.z );
`;

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
  };
  material.userData.skinUniforms = uniforms;
  material.userData.skinTuning = tuning;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'uniform float skinWrap;',
          'uniform vec3 skinScatterColor;',
          'uniform sampler2D skinMicroNormal;',
          'uniform float skinMicroTiling;',
          'uniform float skinMicroStrength;',
        ].join('\n'),
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
  material.customProgramCacheKey = () => 'mh-skin-v1';
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
