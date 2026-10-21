import {
  DoubleSide,
  MeshDepthMaterial,
  MeshStandardMaterial,
  RGBADepthPacking,
  ShaderChunk,
  type Texture,
} from 'three';

import type { HairPattern } from '@/lib/character/schema';

import { colorToAbsorption, HAIR_COLOR_GLSL, type Rgb } from './hairColor';

/**
 * Hair card shading at web cost, modelled on MetaHuman's unified hair material
 * (MI_hair_unified_cards defaults):
 *  - colour from melanin / redness / dye per strand (±0.1 melanin, ±0.3
 *    redness by the strand's random values), optional dye patterns,
 *  - opacity from the card atlas coverage, thinner towards the tip
 *    (exponent 0.5 at the root .. 1 at the tip),
 *  - Kajiya-Kay strand specular in two lobes along the atlas tangent: a white
 *    primary shifted towards the root and a broader secondary tinted by the
 *    hair colour, plus a soft glow when lit from behind,
 *  - roots darkened where the strands shadow each other.
 * The cards render twice without MSAA (the post stack needs it off): a core
 * pass alpha-tested at 0.5 that writes depth, then a blended pass for the soft
 * strand edges that reads it.
 *
 * Card atlas (Unreal texture layout 2): attribute R = coverage, G/B = values
 * constant along each strand (used as its random seeds); tangent RGB = strand
 * direction in the card's tangent space, A = depth in the card. The root-to-tip
 * coordinate comes from the card geometry (STRAND_U).
 */

const PATTERN_IDS: Record<HairPattern, number> = {
  none: 0,
  ombre: 1,
  roots: 2,
  highlights: 3,
  underlayer: 4,
};

export interface HairLook {
  melanin: number;
  redness: number;
  /** Linear dye colour, or null for natural hair. */
  dye: Rgb | null;
  pattern: HairPattern;
  /** Linear colour the pattern blends the strands towards. */
  patternColor: Rgb;
  patternAmount: number;
}

export const NATURAL_HAIR: HairLook = {
  melanin: 0.5,
  redness: 0.3,
  dye: null,
  pattern: 'none',
  patternColor: [1, 1, 1],
  patternAmount: 0,
};

export interface HairTextures {
  attribute: Texture;
  tangent: Texture | null;
  /**
   * The other atlas layout (one groom uses it): root UV in RG, seed in B,
   * coverage in A, with the strand coordinate in the tangent map's A.
   */
  coverageInAlpha?: boolean;
}

/** Shading constants (MetaHuman defaults where the material has one). */
const TUNING = {
  melaninVariation: 0.1,
  rednessVariation: 0.3,
  alphaRoot: 0.5,
  alphaTip: 1,
  /** Specular level range per strand (Unreal "Specular", 0.5 = F0 0.04). */
  specularMin: 0.4,
  specularMax: 0.6,
  /** Cards light whole bands at once; this keeps curls from frosting over. */
  specularScale: 0.6,
  roughnessMin: 0.3,
  roughnessMax: 0.5,
  primaryShift: -0.08,
  secondaryShift: 0.12,
  wrap: 0.6,
  transmission: 0.6,
  /** Brightness lost to strands shading each other near the scalp. */
  rootShadow: 0.35,
};

interface HairUniforms {
  hairAttribute: { value: Texture | null };
  hairTangentMap: { value: Texture | null };
  hairHasTangentMap: { value: number };
  hairMelanin: { value: number };
  hairRedness: { value: number };
  hairDyeAbsorption: { value: Rgb };
  hairPattern: { value: number };
  hairPatternAbsorption: { value: Rgb };
  hairPatternAmount: { value: number };
}

const VERTEX_PARS = /* glsl */ `
attribute vec4 tangent;
attribute float hairStrandU;
varying vec3 vHairTangent;
varying float vHairHandedness;
varying float vHairStrandU;
varying vec2 vHairUv;
`;

// After skinnormal_vertex: skinMatrix exists when the mesh is skinned.
const VERTEX_TANGENT = /* glsl */ `
vec3 hairObjectTangent = tangent.xyz;
#ifdef USE_SKINNING
  hairObjectTangent = ( skinMatrix * vec4( hairObjectTangent, 0.0 ) ).xyz;
#endif
vHairTangent = normalize( ( modelViewMatrix * vec4( hairObjectTangent, 0.0 ) ).xyz );
vHairHandedness = tangent.w;
vHairStrandU = hairStrandU;
vHairUv = uv;
`;

const FRAGMENT_PARS = /* glsl */ `
uniform sampler2D hairAttribute;
uniform sampler2D hairTangentMap;
uniform float hairHasTangentMap;
uniform float hairMelanin;
uniform float hairRedness;
uniform vec3 hairDyeAbsorption;
uniform int hairPattern;
uniform vec3 hairPatternAbsorption;
uniform float hairPatternAmount;
varying vec3 vHairTangent;
varying float vHairHandedness;
varying float vHairStrandU;
varying vec2 vHairUv;
${HAIR_COLOR_GLSL}
// Per-fragment strand state read by RE_Direct_Hair.
vec3 hairT;
vec3 hairSecondaryTint;
float hairSpecularLevel;
float hairExponent;
float hairShiftNoise;
float hairRootShadow;
`;

// Replaces alphamap_fragment: colour and opacity of the strand under this pixel.
const STRAND_COLOR = /* glsl */ `
vec4 hairAttr = texture2D( hairAttribute, vHairUv );
float hairU = saturate( vHairStrandU );
#ifdef HAIR_COVERAGE_IN_ALPHA
float hairCoverage = hairAttr.a;
float hairSeed = hairAttr.b;
float hairSeed2 = fract( ( hairAttr.r + hairAttr.g ) * 61.7 );
float hairDepth = 0.5;
#else
float hairCoverage = hairAttr.r;
float hairSeed = hairAttr.b;
float hairSeed2 = hairAttr.g;
float hairDepth = hairHasTangentMap > 0.5 ? texture2D( hairTangentMap, vHairUv ).a : 0.5;
#endif
diffuseColor.a *= pow( max( hairCoverage, 1e-4 ), mix( ${TUNING.alphaRoot.toFixed(2)}, ${TUNING.alphaTip.toFixed(2)}, hairU ) );
vec3 hairAbs = hairAbsorption(
  hairMelanin + ( hairSeed - 0.5 ) * ${(2 * TUNING.melaninVariation).toFixed(2)},
  hairRedness + ( hairSeed2 - 0.5 ) * ${(2 * TUNING.rednessVariation).toFixed(2)}
) + hairDyeAbsorption;
// How far this strand moves to the pattern colour: regions scale with the
// amount, highlights pick that share of strands and colour them fully.
float hairPatternMix = 0.0;
if ( hairPattern == 1 ) hairPatternMix = smoothstep( 0.35, 0.95, hairU ) * hairPatternAmount;
else if ( hairPattern == 2 ) hairPatternMix = ( 1.0 - smoothstep( 0.08, 0.22, hairU ) ) * hairPatternAmount;
else if ( hairPattern == 3 ) hairPatternMix = step( 1.0 - hairPatternAmount * 0.5, fract( hairSeed * 7.31 + hairSeed2 * 3.17 ) );
else if ( hairPattern == 4 ) hairPatternMix = smoothstep( 0.45, 0.7, hairDepth ) * hairPatternAmount;
hairAbs = mix( hairAbs, hairPatternAbsorption, saturate( hairPatternMix ) );
diffuseColor.rgb = hairAbsorptionToColor( hairAbs );
hairSecondaryTint = sqrt( diffuseColor.rgb );
hairSpecularLevel = mix( ${TUNING.specularMin.toFixed(2)}, ${TUNING.specularMax.toFixed(2)}, hairSeed2 ) * ${(0.08 * TUNING.specularScale).toFixed(3)};
float hairRoughness = mix( ${TUNING.roughnessMin.toFixed(2)}, ${TUNING.roughnessMax.toFixed(2)}, hairSeed );
hairExponent = 20.0 / ( hairRoughness * hairRoughness );
hairShiftNoise = ( hairSeed - 0.5 ) * 0.12;
hairRootShadow = 1.0 - ${TUNING.rootShadow.toFixed(2)} * ( 1.0 - smoothstep( 0.0, 0.3, hairU ) );
`;

// After normal_fragment_maps: strand direction in view space.
const STRAND_TANGENT = /* glsl */ `
{
  vec3 t = normalize( vHairTangent - normal * dot( normal, vHairTangent ) );
  vec3 b = cross( normal, t ) * vHairHandedness;
  vec3 dir = hairHasTangentMap > 0.5 ? texture2D( hairTangentMap, vHairUv ).xyz * 2.0 - 1.0 : vec3( 0.0, 1.0, 0.0 );
  hairT = normalize( dir.x * t + dir.y * b + dir.z * normal );
}
`;

const HAIR_DIRECT = /* glsl */ `
float hairLobe( vec3 T, vec3 H, float exponent ) {
  float TdotH = dot( T, H );
  float sinTH = sqrt( max( 1.0 - TdotH * TdotH, 0.0 ) );
  // A cone, not a lobe: every strand square to the half vector lights up, so
  // the peak stays at the strand's specular level (normalising it like a
  // microfacet lobe washes dark hair out to white).
  return pow( sinTH, exponent );
}
void RE_Direct_Hair( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  vec3 L = directLight.direction;
  float NdotL = dot( geometryNormal, L );
  float wrapped = saturate( ( NdotL + ${TUNING.wrap.toFixed(2)} ) / ${(1 + TUNING.wrap).toFixed(2)} );
  float TdotL = dot( hairT, L );
  float strand = sqrt( max( 1.0 - TdotL * TdotL, 0.0 ) );
  // Light through the strands when lit from behind (Marschner's TT lobe, roughly).
  float through = pow( saturate( dot( -L, geometryViewDir ) ), 6.0 ) * ${TUNING.transmission.toFixed(2)};
  reflectedLight.directDiffuse += directLight.color * BRDF_Lambert( material.diffuseContribution )
    * ( wrapped * mix( 1.0, strand, 0.5 ) * hairRootShadow + through * hairSecondaryTint * 4.0 );
  vec3 H = normalize( L + geometryViewDir );
  vec3 T1 = normalize( hairT + geometryNormal * ( ${TUNING.primaryShift.toFixed(2)} + hairShiftNoise ) );
  vec3 T2 = normalize( hairT + geometryNormal * ( ${TUNING.secondaryShift.toFixed(2)} + hairShiftNoise ) );
  vec3 specular = hairLobe( T1, H, hairExponent ) * vec3( 1.0 )
    + hairLobe( T2, H, hairExponent * 0.25 ) * hairSecondaryTint * 0.6;
  reflectedLight.directSpecular += directLight.color * specular * hairSpecularLevel * wrapped * hairRootShadow;
}
// Environment light reflects off the strands without the card's Fresnel: the
// card plane is not the fibre surface, and its grazing Fresnel greys the hair.
void RE_IndirectSpecular_Hair( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  reflectedLight.indirectSpecular += radiance * hairSpecularLevel * hairRootShadow;
}
#undef RE_Direct
#define RE_Direct RE_Direct_Hair
#undef RE_IndirectSpecular
#define RE_IndirectSpecular RE_IndirectSpecular_Hair
`;

let warned = false;
function chunksMatch(): boolean {
  const ok =
    /#define RE_Direct\s+RE_Direct_Physical/.test(ShaderChunk.lights_physical_pars_fragment) &&
    ShaderChunk.skinnormal_vertex.includes('skinMatrix') &&
    ShaderChunk.meshphysical_frag.includes('#include <alphamap_fragment>');
  if (!ok && !warned) {
    warned = true;
    console.warn('[mh hair] three.js shader chunks changed; hair falls back to plain PBR');
  }
  return ok;
}

export interface HairMaterials {
  /** Alpha-tested, depth-writing strand cores; casts the shadow. */
  core: MeshStandardMaterial;
  /** Blended soft strand edges drawn after the cores. */
  fringe: MeshStandardMaterial;
  /** Shadow depth with the strand coverage cut-out. */
  depth: MeshDepthMaterial;
  uniforms: HairUniforms;
}

function hairMaterial(
  name: string,
  uniforms: HairUniforms,
  pass: 'core' | 'fringe',
  coverageInAlpha: boolean,
) {
  const material = new MeshStandardMaterial({
    name,
    roughness: 0.55,
    metalness: 0,
    envMapIntensity: 0.45,
    side: DoubleSide,
    alphaTest: pass === 'core' ? 0.5 : 0.02,
    transparent: pass === 'fringe',
    depthWrite: pass === 'core',
  });
  if (!chunksMatch()) return material;
  if (coverageInAlpha) material.defines = { HAIR_COVERAGE_IN_ALPHA: '' };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <skinnormal_vertex>', `#include <skinnormal_vertex>\n${VERTEX_TANGENT}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <alphamap_fragment>', STRAND_COLOR)
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>\n${STRAND_TANGENT}`,
      )
      .replace(
        '#include <lights_physical_pars_fragment>',
        `#include <lights_physical_pars_fragment>\n${HAIR_DIRECT}`,
      );
  };
  material.customProgramCacheKey = () => `mh-hair-v1-${pass}${coverageInAlpha ? '-alpha' : ''}`;
  return material;
}

function hairDepthMaterial(uniforms: HairUniforms, coverageInAlpha: boolean): MeshDepthMaterial {
  const channel = coverageInAlpha ? 'a' : 'r';
  const material = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, alphaTest: 0.5 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.hairAttribute = uniforms.hairAttribute;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vHairUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHairUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D hairAttribute;\nvarying vec2 vHairUv;',
      )
      .replace(
        '#include <alphatest_fragment>',
        `diffuseColor.a = texture2D( hairAttribute, vHairUv ).${channel};\n#include <alphatest_fragment>`,
      );
  };
  material.customProgramCacheKey = () => `mh-hair-depth-v1-${channel}`;
  return material;
}

export function createHairMaterials(name: string, textures: HairTextures): HairMaterials {
  const layout = textures.coverageInAlpha ?? false;
  const uniforms: HairUniforms = {
    hairAttribute: { value: textures.attribute },
    hairTangentMap: { value: textures.tangent },
    hairHasTangentMap: { value: textures.tangent ? 1 : 0 },
    hairMelanin: { value: NATURAL_HAIR.melanin },
    hairRedness: { value: NATURAL_HAIR.redness },
    hairDyeAbsorption: { value: [0, 0, 0] },
    hairPattern: { value: 0 },
    hairPatternAbsorption: { value: [0, 0, 0] },
    hairPatternAmount: { value: 0 },
  };
  return {
    core: hairMaterial(`${name}_core`, uniforms, 'core', layout),
    fringe: hairMaterial(`${name}_fringe`, uniforms, 'fringe', layout),
    depth: hairDepthMaterial(uniforms, layout),
    uniforms,
  };
}

/** Recolours hair without recompiling (uniforms only). */
export function setHairLook(materials: HairMaterials, look: HairLook): void {
  const u = materials.uniforms;
  u.hairMelanin.value = look.melanin;
  u.hairRedness.value = look.redness;
  u.hairDyeAbsorption.value = look.dye ? colorToAbsorption(look.dye) : [0, 0, 0];
  u.hairPattern.value = PATTERN_IDS[look.pattern];
  u.hairPatternAbsorption.value = colorToAbsorption(look.patternColor);
  u.hairPatternAmount.value = look.pattern === 'none' ? 0 : look.patternAmount;
}
