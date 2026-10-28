import {
  DoubleSide,
  MeshPhysicalMaterial,
  ShaderChunk,
  Vector4,
  Vector3,
  type MeshStandardMaterial,
  type Texture,
} from 'three';

import {
  FABRIC_SLOTS,
  inverseAverage,
  planFabric,
  scalar,
  vector,
  type FabricPlan,
  type FabricSlot,
  type OutfitMaterialSpec,
} from './fabric';
import type { Rgb } from './hairColor';

/**
 * Unreal's MetaHuman fabric graph (M_fabric_simpler) on three's physical
 * material. Two fabric regions (A and B, split by the region mask) each get
 * base colours from the colour masks, normalised detail colour, overlay-blended
 * detail/macro/wear variation shaping the colour by exponent, tiled detail
 * normals and a specular level from the variation; then pilling, wrinkles,
 * fuzz towards grazing angles and an optional region C (zips, buttons) with
 * its own colour, metalness and roughness. Normals combine by reoriented
 * normal mapping (Unreal's BlendAngleCorrectedNormals); stitches add a bump
 * from their mask. Static switches compile in as defines, so every material
 * runs only the branches its instance uses.
 */

const SPECULAR_LINE = 'float specularIntensityFactor = specularIntensity;';
const F90_LINE = 'material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );';
const NORMAL_MAPS = '#include <normal_fragment_maps>';

let warned = false;
function chunksMatch(): boolean {
  const ok =
    ShaderChunk.lights_physical_fragment.includes(SPECULAR_LINE) &&
    ShaderChunk.lights_physical_fragment.includes(F90_LINE);
  if (!ok && !warned) {
    warned = true;
    console.warn('[mh fabric] three.js shader chunks changed; garments fall back to PBR');
  }
  return ok;
}

const CHANNELS = 'rgba';

/** How each slot reads: own map, pack channel or constant (part of the program key). */
const layoutOf = (plan: FabricPlan) =>
  FABRIC_SLOTS.map((slot) => {
    const packed = plan.packed[slot];
    if (plan.maps[slot]) return 'm';
    return packed ? `${packed.pack}${CHANNELS[packed.channel]}` : 'c';
  }).join('');

/** Per-slot map, pack channel or constant, behind one FAB_SAMPLE_<SLOT>(uv) macro. */
function samplerPars(plan: FabricPlan): string {
  const lines = plan.packs.map((_, k) => `uniform sampler2D fabPack${k};`);
  FABRIC_SLOTS.forEach((slot, i) => {
    const sample = `#define FAB_SAMPLE_${slot.toUpperCase()}( uv )`;
    const packed = plan.packed[slot];
    if (plan.maps[slot]) {
      lines.push(`uniform sampler2D fabMap${i};`, `${sample} texture2D( fabMap${i}, uv )`);
    } else if (packed) {
      const channel = CHANNELS[packed.channel]!;
      lines.push(`${sample} vec4( texture2D( fabPack${packed.pack}, uv ).${channel} )`);
    } else {
      lines.push(`${sample} fabConstant[ ${i} ]`);
    }
  });
  return lines.join('\n');
}

const pars = (plan: FabricPlan) => /* glsl */ `
uniform vec4 fabConstant[ ${FABRIC_SLOTS.length} ];
uniform vec3 fabColor1;
uniform vec3 fabColor2;
uniform vec3 fabColorB1;
uniform vec3 fabColorC;
// x, y: detail UV scale; z: macro UV scale.
uniform vec3 fabTilingA;
uniform vec3 fabTilingB;
// detail variation, macro, wear, overlay amount
uniform vec4 fabVariationA;
uniform vec4 fabVariationB;
// exponent low, exponent high, specular low, specular high
uniform vec4 fabShapeA;
uniform vec4 fabShapeB;
// roughness multiplier, metallic, detail normal strength, 1 / detail colour mean
uniform vec4 fabSurfaceA;
uniform vec4 fabSurfaceB;
// detail colour overlay, detail colour multiply, fuzz amount
uniform vec3 fabDetailA;
uniform vec3 fabDetailB;
// fuzz power, fuzz exponent, stitch bump strength, region B colour 1 or 2
uniform vec4 fabFuzz;
// pilling UV scale, pilling normal strength, pilling colour strength, wrinkle UV scale
uniform vec4 fabPill;
uniform float fabWrinkleStrength;
// mask overlay, AO multiply, roughness, metalness of region C
uniform vec4 fabRegionC;
uniform float fabSpecularC;
// green sign of the tangent maps: detail A, detail B, wrinkle, pilling (DirectX = -1)
uniform vec4 fabGreen;
${samplerPars(plan)}

float fabSpecular;

float fabOverlay( float a, float b ) {
  return a < 0.5 ? 2.0 * a * b : 1.0 - 2.0 * ( 1.0 - a ) * ( 1.0 - b );
}
vec3 fabOverlay3( vec3 a, vec3 b ) {
  return vec3( fabOverlay( a.r, b.r ), fabOverlay( a.g, b.g ), fabOverlay( a.b, b.b ) );
}
// Reoriented normal mapping (tangent space, z up).
vec3 fabRnm( vec3 n1, vec3 n2 ) {
  n1 += vec3( 0.0, 0.0, 1.0 );
  n2 *= vec3( - 1.0, - 1.0, 1.0 );
  return normalize( n1 * dot( n1, n2 ) / n1.z - n2 );
}
vec3 fabDecode( vec4 texel, float green ) {
  vec3 n = texel.xyz * 2.0 - 1.0;
  n.y *= green;
  return n;
}
vec3 fabTowards( vec3 n, float amount ) {
  return normalize( mix( vec3( 0.0, 0.0, 1.0 ), n, amount ) );
}
vec3 fabBump( vec3 position, vec3 normal, vec2 dHdxy, float faceDirection ) {
  vec3 sigmaX = normalize( dFdx( position ) );
  vec3 sigmaY = normalize( dFdy( position ) );
  vec3 r1 = cross( sigmaY, normal );
  vec3 r2 = cross( normal, sigmaX );
  float det = dot( sigmaX, r1 ) * faceDirection;
  vec3 gradient = sign( det ) * ( dHdxy.x * r1 + dHdxy.y * r2 );
  return normalize( abs( det ) * normal - gradient );
}
`;

/** One fabric region; B reads the B_ maps and parameters. */
function region(r: 'A' | 'B'): string {
  const slot = (name: string) => `FAB_SAMPLE_${(r === 'B' ? `B_${name}` : name).toUpperCase()}`;
  const green = r === 'A' ? 'fabGreen.x' : 'fabGreen.y';
  const stitchFade = r === 'A' ? ' * ( 1.0 - fabStitch )' : '';
  return /* glsl */ `
  vec3 fabColor${r};
  float fabRough${r};
  float fabSpec${r};
  vec3 fabNormal${r};
  {
    vec2 uvDetail = vUv * fabTiling${r}.xy;
    vec2 uvMacro = vUv * fabTiling${r}.z;
    vec3 base = fabBase${r};
    vec3 detailColor = ${slot('DetailTex_Color')}( uvDetail ).r * fabSurface${r}.w * base;
    #ifdef FAB_${r}_DETAIL_COLOR
    vec3 color = detailColor;
    #else
    vec3 color = mix( detailColor, base, fabDetail${r}.x );
    #endif
    color = mix( color, detailColor * color, fabDetail${r}.y );
    #ifdef FAB_${r}_SCULPT_DETAIL
    float sculpt = fabMasks.a;
    #else
    float sculpt = ${slot('DetailTex_Variation')}( uvDetail ).r;
    #endif
    #ifdef FAB_${r}_DETAIL_VARIATION
    float detailVariation = mix( 0.5, sculpt, fabVariation${r}.x );
    #else
    float detailVariation = 0.5;
    #endif
    #ifdef FAB_${r}_MACRO_VARIATION
    float macroVariation = mix( 0.5, ${slot('MacroTex_Variation')}( uvMacro ).r, fabVariation${r}.y );
    #else
    float macroVariation = 0.5;
    #endif
    #ifdef FAB_${r}_PAINTED_WEAR
    float wear = mix( 0.5, fabMasks.r, fabVariation${r}.z );
    #else
    float wear = 0.5;
    #endif
    float variation = fabOverlay( fabOverlay( detailVariation, macroVariation ), wear );
    float exponent = variation < 0.5
      ? mix( fabShape${r}.x, 1.0, variation * 2.0 )
      : mix( 1.0, fabShape${r}.y, variation * 2.0 - 1.0 );
    fabColor${r} = fabOverlay3(
      pow( max( color, vec3( 0.0 ) ), vec3( exponent ) ),
      vec3( mix( 0.5, variation, fabVariation${r}.w ) )
    );
    fabRough${r} = fabSurface${r}.x * fabAo.g;
    fabSpec${r} = mix( fabShape${r}.z, fabShape${r}.w, sculpt );
    #ifdef FAB_${r}_DETAIL_NORMAL
    fabNormal${r} = fabTowards(
      fabDecode( ${slot('detailTex_normal')}( uvDetail ), ${green} ),
      fabSurface${r}.z${stitchFade}
    );
    #else
    fabNormal${r} = vec3( 0.0, 0.0, 1.0 );
    #endif
  }
`;
}

const FABRIC = /* glsl */ `
  vec4 fabMasks = FAB_SAMPLE_MASKS( vUv );
  float fabStitch = FAB_SAMPLE_CUSTOMSTITCH( vUv ).r;
  #ifdef USE_AOMAP
  vec4 fabAo = texture2D( aoMap, vAoMapUv );
  #else
  vec4 fabAo = vec4( 1.0, 1.0, 0.0, 0.0 );
  #endif
  #ifdef FAB_STITCH_COLOR_2
  vec3 fabBaseA = mix( fabColor1, fabColor2, fabStitch );
  #else
  vec3 fabBaseA = mix( fabColor1, fabColor2, fabMasks.g );
  #endif
  ${region('A')}
  fabColorA = mix( fabColorA, fabColor2, fabStitch );
  vec3 fabColor = fabColorA;
  float fabRough = fabRoughA;
  float fabSpec = fabSpecA;
  float fabMetal = fabSurfaceA.y;
  vec3 fabNormal = fabNormalA;
  #ifdef FAB_MATERIAL_B
  #ifdef FAB_B_USE_A_COLOR
  vec3 fabFirstB = mix( fabColor2, fabColor1, fabFuzz.w );
  #else
  vec3 fabFirstB = fabColorB1;
  #endif
  vec3 fabBaseB = mix( fabFirstB, fabColor2, fabMasks.g );
  ${region('B')}
  fabColor = mix( fabColor, fabColorB, fabMasks.b );
  fabRough = mix( fabRough, fabRoughB, fabMasks.b );
  fabSpec = mix( fabSpec, fabSpecB, fabMasks.b );
  fabMetal = mix( fabMetal, fabSurfaceB.y, fabMasks.b );
  fabNormal = normalize( mix( fabNormal, fabNormalB, fabMasks.b ) );
  #endif
  #ifdef FAB_PILL
  vec2 fabUvPill = vUv * fabPill.x;
  fabNormal = fabRnm( fabNormal, fabTowards( fabDecode( FAB_SAMPLE_PILL_N_MAP( fabUvPill ), fabGreen.w ), fabPill.y ) );
  float fabPilling = FAB_SAMPLE_PILLING_A( fabUvPill ).r;
  fabColor = mix( fabColor, max( fabColor, fabPill.z * fabPilling * fabBaseA ), 1.0 - fabStitch );
  #endif
  #ifdef FAB_WRINKLES
  fabNormal = fabRnm( fabNormal, fabTowards( fabDecode( FAB_SAMPLE_WRINKLE_NORMAL( vUv * fabPill.w ), fabGreen.z ), fabWrinkleStrength ) );
  #endif

  #ifdef USE_NORMALMAP_TANGENTSPACE
  vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
  mapN.xy *= normalScale;
  // Follow the base map's tangent-frame flip (glTF meshes without tangents use y = -1).
  fabNormal.xy *= sign( normalScale );
  normal = normalize( tbn * fabRnm( normalize( mapN ), fabNormal ) );
  #endif
  // Stitches stand out of the weave: a bump from their mask.
  float fabHeight = fabStitch * fabFuzz.z;
  normal = fabBump( - vViewPosition, normal, vec2( dFdx( fabHeight ), dFdy( fabHeight ) ), faceDirection );

  #ifdef FAB_FUZZ
  float fabFacing = saturate( dot( normal, normalize( vViewPosition ) ) );
  float fabFuzzAmount = mix( fabDetailA.z, fabDetailB.z, fabStitch )
    * ( 0.04 + 0.96 * pow( 1.0 - fabFacing, fabFuzz.x ) );
  fabColor = mix( fabColor, pow( max( fabColor, vec3( 0.0 ) ), vec3( fabFuzz.y ) ), saturate( fabFuzzAmount ) );
  #endif

  #ifdef FAB_MATERIAL_C
  #ifdef FAB_C_USE_A_COLOR
  vec3 fabBaseC = mix( fabColor1, fabColor2, fabMasks.g );
  #else
  vec3 fabBaseC = fabColorC;
  #endif
  vec3 fabColorRegionC = fabOverlay3( fabBaseC, vec3( mix( 0.5, fabMasks.r, fabRegionC.x ) ) )
    * mix( 1.0, fabAo.r, fabRegionC.y );
  #ifdef FAB_C_METAL_MAP
  float fabMetalC = fabAo.b;
  #else
  float fabMetalC = fabRegionC.w;
  #endif
  #ifdef FAB_C_ROUGH_MAP
  float fabRoughC = fabAo.g;
  #else
  float fabRoughC = fabRegionC.z;
  #endif
  fabColor = mix( fabColor, fabColorRegionC, fabAo.a );
  fabMetal = mix( fabMetal, fabMetalC, fabAo.a );
  fabRough = mix( fabRough, fabRoughC, fabAo.a );
  fabSpec = mix( fabSpec, fabSpecularC, fabAo.a );
  #endif

  diffuseColor.rgb = fabColor;
  roughnessFactor = saturate( fabRough );
  metalnessFactor = saturate( fabMetal );
  // Unreal's Specular 0.5 is three's specular intensity 1 (F0 0.04).
  fabSpecular = 2.0 * fabSpec;
`;

export interface FabricUniforms {
  fabColor1: { value: Vector3 };
  fabColor2: { value: Vector3 };
  fabColorB1: { value: Vector3 };
  fabColorC: { value: Vector3 };
  [name: string]: { value: unknown };
}

export interface FabricMaterial {
  material: MeshPhysicalMaterial;
  uniforms: FabricUniforms;
  plan: FabricPlan;
  spec: OutfitMaterialSpec;
}

const green = (spec: OutfitMaterialSpec, slot: string) =>
  spec.textures?.[slot]?.source_convention === 'directx' ? -1 : 1;

/** The textures a fabric plan binds: its own maps by slot and its packs in order. */
export interface FabricTextures {
  maps: Partial<Record<FabricSlot, Texture>>;
  packs: Texture[];
}

/**
 * The fabric material of one garment part. `source` is the converter's glTF
 * approximation, whose normal map and ORM map (AO, roughness, metalness,
 * region C mask) the shader reads; `textures` holds the planned detail maps.
 */
export function createFabricMaterial(
  name: string,
  spec: OutfitMaterialSpec,
  source: MeshStandardMaterial,
  textures: FabricTextures,
): FabricMaterial {
  const plan = planFabric(spec);
  const s = (key: string, fallback: number) => scalar(spec, key, fallback);
  const tiling = (p: '' | 'B_') =>
    new Vector3(
      s(`${p}DetailTex_UVTtiling`, 1) * s(`${p}DetailTex_U_distort`, 1),
      s(`${p}DetailTex_UVTtiling`, 1) * s(`${p}DetailTex_V_distort`, 1),
      s(`${p}MacroTex_UvTiling`, 1),
    );
  const variation = (p: '' | 'B_') =>
    new Vector4(
      s(`${p}DetailTex_VariationStrength`, 0),
      s(`${p}MacroTexStrength`, 0),
      s(`${p}WearMaskStrength`, 0),
      s(`${p}VariationBlendOverlayAmount`, 1),
    );
  const shape = (p: '' | 'B_') =>
    new Vector4(
      s(`${p}VariationExpLow`, 1),
      s(`${p}VariationExpHigh`, 1),
      s(`${p}SpecLow`, 0.5),
      s(`${p}specHigh`, 0.5),
    );
  const surface = (p: '' | 'B_') =>
    new Vector4(
      s(`${p}RoughnessMap_MultValue`, 1),
      s(`${p}Metallic`, 0),
      s(`${p}DetailTex_NormalStrength`, 1),
      inverseAverage(spec.textures?.[`${p}DetailTex_Color`]),
    );
  const detail = (p: '' | 'B_', fuzz: string) =>
    new Vector3(s(`${p}detailColor_txOverlay`, 0), s(`${p}detailColor_txMult`, 0), s(fuzz, 0));

  const uniforms: FabricUniforms = {
    // Sampled slots have no constant; their entry is never read.
    fabConstant: {
      value: FABRIC_SLOTS.map((slot) => new Vector4(...(plan.constants[slot] ?? [0, 0, 0, 0]))),
    },
    fabColor1: { value: new Vector3() },
    fabColor2: { value: new Vector3() },
    fabColorB1: { value: new Vector3() },
    fabColorC: { value: new Vector3() },
    fabTilingA: { value: tiling('') },
    fabTilingB: { value: tiling('B_') },
    fabVariationA: { value: variation('') },
    fabVariationB: { value: variation('B_') },
    fabShapeA: { value: shape('') },
    fabShapeB: { value: shape('B_') },
    fabSurfaceA: { value: surface('') },
    fabSurfaceB: { value: surface('B_') },
    fabDetailA: { value: detail('', 'A_FuzzAmount') },
    fabDetailB: { value: detail('B_', 'B_FuzzAmount') },
    fabFuzz: {
      value: new Vector4(
        s('FuzzPower', 1),
        s('FuzzExp', 1),
        s('normal_CustomStitch_strength', 0),
        s('B_useAcolor_1or2', 0),
      ),
    },
    fabPill: {
      value: new Vector4(
        s('pilling_UV_tiling', 1),
        s('pilling_normal_strength', 0),
        s('pilling_diffuse_strength', 0),
        s('wrinkle_UV_tiling', 1),
      ),
    },
    fabWrinkleStrength: { value: s('wrinkle_normal_strength', 0) },
    fabRegionC: {
      value: new Vector4(
        s('C_MaskOverlayAmount', 0),
        s('C_AOMultAmount', 0),
        s('C_roughness value', 0.5),
        s('c_metalness value', 0),
      ),
    },
    fabSpecularC: { value: s('C_specular value', 0.5) },
    fabGreen: {
      value: new Vector4(
        green(spec, 'detailTex_normal'),
        green(spec, 'B_detailTex_normal'),
        green(spec, 'Wrinkle_normal'),
        green(spec, 'Pill_n_map'),
      ),
    },
  };
  FABRIC_SLOTS.forEach((slot, i) => {
    if (plan.maps[slot]) uniforms[`fabMap${i}`] = { value: textures.maps[slot] ?? null };
  });
  plan.packs.forEach((_, k) => {
    uniforms[`fabPack${k}`] = { value: textures.packs[k] ?? null };
  });

  const material = new MeshPhysicalMaterial({
    name,
    normalMap: source.normalMap,
    normalScale: source.normalScale.clone(),
    aoMap: source.aoMap ?? source.roughnessMap,
    side: DoubleSide,
    // Skin-tight cloth and the skin around its openings lie within a depth step
    // of each other: a bodysuit's straps on a slider end showed as skin and
    // cloth in speckles. Drawn a step nearer, the cloth wins those ties.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  });
  // Live uniforms, for inspection in dev tools.
  material.userData.fabric = uniforms;
  if (chunksMatch()) {
    // Keep three's own STANDARD / PHYSICAL defines.
    material.defines = {
      ...material.defines,
      USE_UV: '',
      ...Object.fromEntries(plan.defines.map((define) => [define, ''])),
    };
    const key = `mh-fabric-v2|${plan.defines.join(',')}|${layoutOf(plan)}`;
    material.customProgramCacheKey = () => key;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${pars(plan)}`)
        .replace(NORMAL_MAPS, FABRIC)
        .replace(SPECULAR_LINE, 'float specularIntensityFactor = fabSpecular;')
        .replace(
          F90_LINE,
          'material.specularF90 = mix( min( specularIntensityFactor, 1.0 ), 1.0, metalnessFactor );',
        );
    };
  }
  const fabric = { material, uniforms, plan, spec };
  setFabricColors(fabric, {});
  return fabric;
}

/** Garment colours: the creator's picks over the instance's own. */
export function setFabricColors(fabric: FabricMaterial, overrides: Readonly<Record<string, Rgb>>) {
  const { spec, uniforms, material } = fabric;
  const pick = (name: string, fallback: Rgb): Rgb =>
    overrides[name] ?? vector(spec, name, fallback);
  const first = pick('diffuse_color_1', [0.5, 0.5, 0.5]);
  uniforms.fabColor1.value.set(...first);
  uniforms.fabColor2.value.set(...pick('diffuse_color_2', first));
  uniforms.fabColorB1.value.set(...pick('B_diffuse_color_1', first));
  uniforms.fabColorC.value.set(...pick('C_color', first));
  // Only the PBR fallback reads it; the fabric shader writes its own colour.
  material.color.setRGB(...first);
}
