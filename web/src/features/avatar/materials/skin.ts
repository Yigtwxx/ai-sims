import { Color, MeshPhysicalMaterial, ShaderChunk, type MeshStandardMaterial } from 'three';

/**
 * Cheap subsurface-scattering approximation for skin.
 *
 * Adds a "wrapped" diffuse term tinted towards red where light falls off
 * (terminator, nose, ears), which is the main visual cue of light bleeding
 * through skin. It patches three's RE_Direct_Physical, so it affects direct
 * lights only; IBL diffuse stays physically based.
 */
export interface SkinOptions {
  /** How far light wraps past the terminator (0 = Lambert, 0.5 = soft). */
  wrap: number;
  /** Tint and strength of the scattered light (linear RGB). */
  scatterColor: Color;
  roughness: number;
  /** Specular F0 scale; skin is ~0.028 F0 which is ~0.35 of the 0.04 default. */
  specularIntensity: number;
  /** Faint velvet layer that mimics peach fuzz at grazing angles. */
  sheen: number;
}

export const DEFAULT_SKIN_OPTIONS: SkinOptions = {
  wrap: 0.45,
  scatterColor: new Color(0.9, 0.28, 0.16),
  roughness: 0.52,
  specularIntensity: 0.55,
  sheen: 0.12,
};

const DIFFUSE_LINE =
  'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );';

const PATCHED_DIFFUSE = /* glsl */ `
  float skinWrapNL = saturate( ( dot( geometryNormal, directLight.direction ) + skinWrap ) / ( 1.0 + skinWrap ) );
  vec3 skinScatter = skinScatterColor * max( skinWrapNL - dotNL, 0.0 ) * directLight.color;
  reflectedLight.directDiffuse += ( irradiance + skinScatter ) * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
`;

export function createSkinMaterial(
  source: MeshStandardMaterial,
  options: SkinOptions = DEFAULT_SKIN_OPTIONS,
): MeshPhysicalMaterial {
  if (!ShaderChunk.lights_physical_pars_fragment.includes(DIFFUSE_LINE)) {
    // three.js changed its shader; fall back to the unpatched physical material.
    console.warn('[skin] RE_Direct_Physical layout changed; SSS approximation disabled');
  }

  const material = new MeshPhysicalMaterial({
    name: `${source.name}_skin`,
    map: source.map,
    normalMap: source.normalMap,
    normalScale: source.normalScale.clone(),
    roughnessMap: source.roughnessMap,
    aoMap: source.aoMap,
    color: source.color.clone(),
    roughness: options.roughness,
    metalness: 0,
    specularIntensity: options.specularIntensity,
    sheen: options.sheen,
    sheenRoughness: 0.6,
    sheenColor: new Color(1, 0.85, 0.8),
    transparent: source.transparent,
    alphaTest: source.alphaTest,
    side: source.side,
  });

  const uniforms = {
    skinWrap: { value: options.wrap },
    skinScatterColor: { value: options.scatterColor },
  };
  material.userData.skinUniforms = uniforms;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float skinWrap;\nuniform vec3 skinScatterColor;',
      )
      .replace(
        '#include <lights_physical_pars_fragment>',
        ShaderChunk.lights_physical_pars_fragment.replace(DIFFUSE_LINE, PATCHED_DIFFUSE),
      );
  };
  material.customProgramCacheKey = () => 'skin-sss-v1';

  return material;
}
