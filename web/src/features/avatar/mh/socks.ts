import { BufferAttribute, Color, type Material, type SkinnedMesh } from 'three';

import {
  NUDE_TIGHTS_COLOR,
  type CharacterBase,
  type CharacterConfig,
} from '@/lib/character/schema';

/**
 * Socks and tights are a layer of the body skin, like the underwear: no mesh,
 * so they never poke out of a shoe or tear on a body slider, and the skin
 * under a garment is dropped with them (see ./garments.ts). Where they reach is
 * a height on the neutral body: its `position` attribute is the body without
 * sliders (they are morphs), so a vertex's rest height is an anatomical
 * coordinate that moves with the leg.
 */

/** Rest height (m) of each body vertex; ARM_HEIGHT on the arms. */
export const LEG_HEIGHT = 'legHeight';
/** Weight of the toe and ball bones per vertex: where tights have their reinforced toe. */
export const TOE_WEIGHT = 'toeWeight';
/** Above any top edge: in the A-pose the hands hang at waist height and tights must miss them. */
export const ARM_HEIGHT = 100;

// MetaHuman arm chains. The toes share finger names ("ringtoe_01_l"), so a
// finger bone is its name followed by an underscore.
const ARM_BONE = /^(clavicle|upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)_/;

export const isArmBone = (name: string): boolean => ARM_BONE.test(name);

/** Toe and ball bones (as the pipeline's sock_toes.py counts them). */
export const isToeBone = (name: string): boolean =>
  name.includes('toe') || name.startsWith('ball_');

interface Heights {
  count: number;
  getY(index: number): number;
}

interface Influences {
  getX(index: number): number;
  getY(index: number): number;
  getZ(index: number): number;
  getW(index: number): number;
}

const components = (attribute: Influences, vertex: number) => [
  attribute.getX(vertex),
  attribute.getY(vertex),
  attribute.getZ(vertex),
  attribute.getW(vertex),
];

/** Each vertex's rest height, or ARM_HEIGHT where the arm bones hold most of its weight. */
export function legHeights(
  positions: Heights,
  skinIndex: Influences,
  skinWeight: Influences,
  armBones: ReadonlySet<number>,
): Float32Array {
  const heights = new Float32Array(positions.count);
  for (let v = 0; v < positions.count; v += 1) {
    heights[v] =
      boneShare(skinIndex, skinWeight, armBones, v) > 0.5 ? ARM_HEIGHT : positions.getY(v);
  }
  return heights;
}

/** Each vertex's weight on the given bones. */
export function boneWeights(
  skinIndex: Influences & { count: number },
  skinWeight: Influences,
  bones: ReadonlySet<number>,
): Float32Array {
  const shares = new Float32Array(skinIndex.count);
  for (let v = 0; v < skinIndex.count; v += 1)
    shares[v] = boneShare(skinIndex, skinWeight, bones, v);
  return shares;
}

function boneShare(
  skinIndex: Influences,
  skinWeight: Influences,
  bones: ReadonlySet<number>,
  vertex: number,
): number {
  const indices = components(skinIndex, vertex);
  const weights = components(skinWeight, vertex);
  let share = 0;
  for (let k = 0; k < 4; k += 1) if (bones.has(indices[k]!)) share += weights[k]!;
  return share;
}

/**
 * Gives a body geometry its LEG_HEIGHT and TOE_WEIGHT attributes. They only
 * depend on the geometry, so characters sharing one body GLB share them too:
 * set once.
 */
export function ensureLegHeights(body: SkinnedMesh): void {
  const geometry = body.geometry;
  if (geometry.getAttribute(LEG_HEIGHT)) return;
  const position = geometry.getAttribute('position');
  const skinIndex = geometry.getAttribute('skinIndex');
  const skinWeight = geometry.getAttribute('skinWeight');
  if (!position || !skinIndex || !skinWeight) return;
  const bonesWhere = (test: (name: string) => boolean) =>
    new Set(body.skeleton.bones.flatMap((bone, index) => (test(bone.name) ? [index] : [])));
  geometry.setAttribute(
    LEG_HEIGHT,
    new BufferAttribute(legHeights(position, skinIndex, skinWeight, bonesWhere(isArmBone)), 1),
  );
  geometry.setAttribute(
    TOE_WEIGHT,
    new BufferAttribute(boneWeights(skinIndex, skinWeight, bonesWhere(isToeBone)), 1),
  );
}

/**
 * Where the toes sit inside a sock, from the pipeline (`sock_toes.py`, the body's
 * `socks` file): knit spans the gaps between the toes and the grooves over them, so
 * the moved vertices take an offset and a normal delta while socks are on.
 */
export const SOCK_TOE_OFFSET = 'sockToeOffset';
export const SOCK_TOE_NORMAL = 'sockToeNormal';

export interface SockToes {
  indices: Uint32Array;
  /** xyz per moved vertex, metres in the body GLB's space. */
  offsets: Float32Array;
  normals: Float32Array;
}

const SOCK_TOES_MAGIC = 0x4b53484d; // "MHSK", little-endian
const SOCK_TOES_FORMAT = 1;

/** Reads a sock toes file: magic, version, count, then indices, offsets and normal deltas. */
export function parseSockToes(buffer: ArrayBuffer): SockToes {
  const view = new DataView(buffer);
  if (buffer.byteLength < 12 || view.getUint32(0, true) !== SOCK_TOES_MAGIC) {
    throw new Error('not a sock toes file');
  }
  const version = view.getUint32(4, true);
  if (version !== SOCK_TOES_FORMAT) throw new Error(`sock toes format ${version}`);
  const count = view.getUint32(8, true);
  if (buffer.byteLength !== 12 + count * 28) throw new Error('sock toes file is truncated');
  return {
    indices: new Uint32Array(buffer.slice(12, 12 + count * 4)),
    offsets: new Float32Array(buffer.slice(12 + count * 4, 12 + count * 16)),
    normals: new Float32Array(buffer.slice(12 + count * 16)),
  };
}

const sockToes = new Map<string, Promise<SockToes | null>>();

/**
 * Loads a sock toes file once per page. A missing or broken file is not an
 * error: the socks are drawn over the bare toes.
 */
export function loadSockToes(url: string): Promise<SockToes | null> {
  let pending = sockToes.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then(parseSockToes)
      .catch((error: unknown) => {
        console.warn('[mh socks] toes not loaded', error);
        return null;
      });
    sockToes.set(url, pending);
  }
  return pending;
}

/**
 * Puts the envelope on a body geometry (shared by every character of that
 * body, so once). Vertices the file does not move get zero, as do all of them
 * while socks are off: the shader scales the offsets by skinSockToes.
 */
export function applySockToes(body: SkinnedMesh, toes: SockToes): void {
  const geometry = body.geometry;
  if (geometry.getAttribute(SOCK_TOE_OFFSET)) return;
  const count = geometry.getAttribute('position')?.count ?? 0;
  if (toes.indices.some((index) => index >= count)) {
    console.warn('[mh socks] toes file does not match the body');
    return;
  }
  const offsets = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  toes.indices.forEach((vertex, i) => {
    offsets.set(toes.offsets.subarray(i * 3, i * 3 + 3), vertex * 3);
    normals.set(toes.normals.subarray(i * 3, i * 3 + 3), vertex * 3);
  });
  geometry.setAttribute(SOCK_TOE_OFFSET, new BufferAttribute(offsets, 3));
  geometry.setAttribute(SOCK_TOE_NORMAL, new BufferAttribute(normals, 3));
}

/** Joint heights (m) of the neutral bodies, from their inverse binds (measured 2026-10-29). */
export const LEG_JOINTS: Record<CharacterBase, { ankle: number; knee: number; waist: number }> = {
  female: { ankle: 0.076, knee: 0.459, waist: 0.92 },
  male: { ankle: 0.085, knee: 0.486, waist: 0.956 },
};

/**
 * Where each length ends, from a joint: ankle socks just over the ankle bone,
 * knee socks a hand's width under the knee, tights at the waist. `cuff` is the
 * ribbed cuff or waistband under the top edge.
 */
const SOCK_FIT = {
  ankle: { joint: 'ankle', offset: 0.05, cuff: 0.015 },
  knee: { joint: 'knee', offset: -0.06, cuff: 0.03 },
  tights: { joint: 'waist', offset: 0.03, cuff: 0.025 },
} as const;

export type SockFabric = 'cotton' | 'nylon';

export interface SockWear {
  /** Height (m, neutral body) of the top edge. */
  top: number;
  /** Height (m) of the cuff or waistband under the top edge. */
  cuff: number;
  /** Linear RGB. */
  color: [number, number, number];
  /** How much skin shows through, 0 opaque .. 1 the finest; only nylon is sheer. */
  sheer: number;
  fabric: SockFabric;
  /** Nude tights: the colour is the wearer's own skin, evened out (NUDE_TIGHTS_COLOR). */
  nude: boolean;
}

/** The socks a body wears, or null for none (and for tights on a man's body). */
export function sockWear(socks: CharacterConfig['socks'], base: CharacterBase): SockWear | null {
  if (socks.style === 'none' || (socks.style === 'tights' && base !== 'female')) return null;
  const fit = SOCK_FIT[socks.style];
  const color = new Color(socks.color);
  const nylon = socks.style === 'tights';
  return {
    top: LEG_JOINTS[base][fit.joint] + fit.offset,
    cuff: fit.cuff,
    color: [color.r, color.g, color.b],
    sheer: nylon ? socks.sheer : 0,
    fabric: nylon ? 'nylon' : 'cotton',
    nude: nylon && socks.color.toLowerCase() === NUDE_TIGHTS_COLOR,
  };
}

/** Tights at sheer 1 still hide this much of the skin, seen straight on. */
export const FINEST_OPACITY = 0.22;
/** How much of the skin the reinforced toe of tights hides, however sheer the rest. */
export const TOE_REINFORCED = 0.92;

/**
 * Sheerness eases in: halfway down the slider tights still read as tights
 * (about 70 % cover), the fine end is a veil.
 */
export const SHEER_CURVE = 1.5;

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * CPU mirror of SOCKS (below) at one point, for tests: `cover` is where the
 * sock is, `band` its cuff, `cloth` how much of the skin it hides. `viewDot`
 * is N·V: sheer nylon looks denser at grazing angles, where the eye looks
 * through more of it. `toeWeight` is the point's TOE_WEIGHT.
 */
export function sockLayer(
  height: number,
  wear: SockWear | null,
  viewDot = 1,
  { edge = 1e-3, toeWeight = 0 }: { edge?: number; toeWeight?: number } = {},
): { cover: number; band: number; cloth: number } {
  if (!wear) return { cover: 0, band: 0, cloth: 0 };
  const cover = 1 - smoothstep(wear.top - edge, wear.top + edge, height);
  const band = cover * smoothstep(wear.top - wear.cuff - edge, wear.top - wear.cuff + edge, height);
  const nylon = wear.fabric === 'nylon' ? 1 : 0;
  const facing = 1 - (1 - FINEST_OPACITY) * wear.sheer ** SHEER_CURVE * nylon;
  const toe = TOE_REINFORCED * smoothstep(0.1, 0.5, toeWeight);
  const opacity = Math.max(facing + (1 - facing) * (1 - viewDot) ** 2, band, toe);
  return { cover, band, cloth: cover * opacity };
}

/** Sock inputs of the body skin; set by setSocks, no recompile. */
export interface SockUniforms {
  /** Below this rest height the leg is covered (-1: no socks). */
  skinSockTop: { value: number };
  skinSockCuff: { value: number };
  skinSockColor: { value: Color };
  skinSockSheer: { value: number };
  /** 0 cotton, 1 nylon. */
  skinSockNylon: { value: number };
  /** 1: nude tights, coloured by the skin under them. */
  skinSockNude: { value: number };
  /** How much of the toe envelope applies (0 without socks, see SOCK_TOE_OFFSET). */
  skinSockToes: { value: number };
}

export function createSockUniforms(): SockUniforms {
  return {
    skinSockTop: { value: -1 },
    skinSockCuff: { value: 0 },
    skinSockColor: { value: new Color(0, 0, 0) },
    skinSockSheer: { value: 0 },
    skinSockNylon: { value: 0 },
    skinSockNude: { value: 0 },
    skinSockToes: { value: 0 },
  };
}

/** Puts socks on (or takes them off) the body skin materials. */
export function setSocks(materials: readonly Material[], wear: SockWear | null): void {
  for (const material of materials) {
    const uniforms = material.userData.sockUniforms as SockUniforms | null | undefined;
    if (!uniforms) continue;
    uniforms.skinSockTop.value = wear ? wear.top : -1;
    uniforms.skinSockCuff.value = wear?.cuff ?? 0;
    uniforms.skinSockColor.value.setRGB(...(wear?.color ?? [0, 0, 0]));
    uniforms.skinSockSheer.value = wear?.sheer ?? 0;
    uniforms.skinSockNylon.value = wear?.fabric === 'nylon' ? 1 : 0;
    uniforms.skinSockNude.value = wear?.nude ? 1 : 0;
    uniforms.skinSockToes.value = wear ? 1 : 0;
  }
}

// Without the toes file the attributes are missing and read as zero.
export const SOCKS_VERTEX_PARS = /* glsl */ `
#ifdef MH_SOCKS
attribute float ${LEG_HEIGHT};
attribute vec3 ${SOCK_TOE_OFFSET};
attribute vec3 ${SOCK_TOE_NORMAL};
attribute float ${TOE_WEIGHT};
uniform float skinSockToes;
varying float vLegHeight;
varying float vToeWeight;
#endif
`;
// Before the morphs and the skinning: the offsets are in the bind pose, like the mesh.
export const SOCKS_VERTEX = /* glsl */ `
#ifdef MH_SOCKS
  vLegHeight = ${LEG_HEIGHT};
  vToeWeight = ${TOE_WEIGHT};
  transformed += ${SOCK_TOE_OFFSET} * skinSockToes;
#endif
`;
export const SOCKS_NORMAL_VERTEX = /* glsl */ `
#ifdef MH_SOCKS
  objectNormal = normalize( objectNormal + ${SOCK_TOE_NORMAL} * skinSockToes );
#endif
`;

// Globals: the map stage sets them, the lights and the normal read them.
export const SOCKS_PARS = /* glsl */ `
#ifdef MH_SOCKS
uniform float skinSockTop;
uniform float skinSockCuff;
uniform vec3 skinSockColor;
uniform float skinSockSheer;
uniform float skinSockNylon;
uniform float skinSockNude;
varying float vLegHeight;
varying float vToeWeight;
float sockCloth = 0.0;
vec2 sockTilt = vec2( 0.0 );
// Hash without sine (Hoskins), smooth value noise over it.
float sockHash( vec2 p ) {
  vec3 p3 = fract( p.xyx * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float sockNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( sockHash( i ), sockHash( i + vec2( 1.0, 0.0 ) ), f.x ),
    mix( sockHash( i + vec2( 0.0, 1.0 ) ), sockHash( i + vec2( 1.0, 1.0 ) ), f.x ),
    f.y
  );
}
#endif
`;

// Knit loops of about 1.2 x 1 mm and yarn of uneven thickness, streaks about
// 1.4 mm across and 6 mm along the knit: the legs span about 0.65 UV per metre
// along and around, running up along v. Each pattern fades out where a pixel
// spans more than half its period, so it never shimmers. Derivatives first:
// inside a branch they are undefined.
export const SOCKS = /* glsl */ `
#if defined( MH_SOCKS ) && defined( USE_MAP )
  float sockEdge = min( fwidth( vLegHeight ), 0.01 ) + 1e-4;
  vec2 sockLoop = vMapUv * vec2( 1280.0, 1540.0 );
  vec2 sockYarn = vMapUv * vec2( 1100.0, 260.0 );
  float sockLoopFade = 1.0 - smoothstep( 0.25, 0.5, max( fwidth( sockLoop.x ), fwidth( sockLoop.y ) ) );
  float sockYarnFade = 1.0 - smoothstep( 0.3, 0.7, max( fwidth( sockYarn.x ), fwidth( sockYarn.y ) ) );
  float sockCover = 1.0 - smoothstep( skinSockTop - sockEdge, skinSockTop + sockEdge, vLegHeight );
  float sockBand = sockCover * smoothstep( skinSockTop - skinSockCuff - sockEdge, skinSockTop - skinSockCuff + sockEdge, vLegHeight );
  // The top 3 mm: the cuff's folded edge, standing off the skin.
  float sockRim = sockCover * smoothstep( skinSockTop - 0.003 - sockEdge, skinSockTop - sockEdge, vLegHeight );
  // The edge stands off the skin and presses into it: a contact shadow just over it,
  // strongest at the edge and gone 1 cm up (fainter under thin nylon).
  float sockLip = ( 1.0 - sockCover ) * pow( 1.0 - smoothstep( skinSockTop, skinSockTop + 0.01, vLegHeight ), 2.0 );
  diffuseColor.rgb *= 1.0 - mix( 0.35, 0.12, skinSockNylon ) * sockLip * step( 0.0, skinSockTop );
  if ( sockCover > 0.0 ) {
    float sockCotton = 1.0 - skinSockNylon;
    // Chevrons of a plain jersey knit, the cuff too; nylon is too fine to show them.
    float weave = sin( 6.2832 * ( sockLoop.x + abs( fract( sockLoop.y ) - 0.5 ) ) ) * sockLoopFade * sockCotton;
    float yarn = ( sockNoise( sockYarn ) * 2.0 - 1.0 ) * sockYarnFade;
    // In the tangent frame +y runs up the leg: the rim's normal tips up into the key light.
    sockTilt = vec2( 0.3 * weave, 0.6 * sockRim * sockCotton );
    // Sheer nylon hides less of the skin seen straight on, more at grazing angles
    // (vViewPosition points from the surface to the eye).
    float sockFacing = 1.0 - ${(1 - FINEST_OPACITY).toFixed(2)} * pow( skinSockSheer, ${SHEER_CURVE.toFixed(1)} ) * skinSockNylon;
    float sockNdV = saturate( dot( normalize( vNormal ), normalize( vViewPosition ) ) );
    // The waistband and the reinforced toe are knitted denser: near opaque.
    float sockToe = ${TOE_REINFORCED.toFixed(2)} * smoothstep( 0.1, 0.5, vToeWeight );
    float sockOpacity = max( mix( sockFacing, 1.0, pow( 1.0 - sockNdV, 2.0 ) ), max( sockBand, sockToe ) );
    sockCloth = sockCover * sockOpacity;
    // Nude tights are the wearer's own tone, evened out: the skin a few mips
    // down (pores and blotches gone), a shade deeper.
    vec3 sockBase = mix( skinSockColor, diffuse * texture2D( map, vMapUv, 4.0 ).rgb * 0.9, skinSockNude );
    vec3 sockAlbedo = sockBase * ( 1.0 + ( 0.06 * weave + 0.05 * yarn ) * sockCotton );
    // Through coloured nylon the skin loses some of its own colour.
    float sockDull = 0.3 * sockCover * skinSockNylon * ( 1.0 - skinSockNude );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( luminance( diffuseColor.rgb ) ), sockDull );
    diffuseColor.rgb = mix( diffuseColor.rgb, sockAlbedo, sockCloth );
  }
#endif
`;

// Cotton is matte; nylon has a soft shine, a little more the finer it is.
export const SOCKS_ROUGHNESS = /* glsl */ `
#ifdef MH_SOCKS
  roughnessFactor = mix( roughnessFactor, mix( 0.9, mix( 0.75, 0.55, skinSockSheer ), skinSockNylon ), sockCloth );
#endif
`;
export const SOCKS_SPECULAR = /* glsl */ `
#ifdef MH_SOCKS
  specularIntensityFactor = mix( specularIntensityFactor, mix( 0.25, mix( 0.3, 0.5, skinSockSheer ), skinSockNylon ), sockCloth );
#endif
`;
// Fibres catch the light at the silhouette: the sheen of the cloth, not the skin's.
export const SOCKS_SHEEN = /* glsl */ `
#if defined( MH_SOCKS ) && defined( USE_SHEEN )
  material.sheenColor = mix( material.sheenColor, mix( skinSockColor * 0.35 + 0.03, vec3( 0.15 ), skinSockNylon ), sockCloth );
  material.sheenRoughness = mix( material.sheenRoughness, mix( 0.6, 0.4, skinSockNylon ), sockCloth );
#endif
`;
// Opaque cloth hides the skin's pores and folds; sheer nylon only partly. The
// tilt is built in the frame three's tangent derivation gives (+x along u, +y
// along v), after the base map's flip: no sign to follow.
export const SOCKS_NORMAL = /* glsl */ `
  #if defined( MH_SOCKS ) && defined( USE_NORMALMAP_TANGENTSPACE )
  if ( sockCloth > 0.0 ) {
    vec3 sockN = normalize( vec3( sockTilt, 1.0 ) );
    mapN = mix( mapN, sockN, sockCloth );
  }
  #endif
`;
