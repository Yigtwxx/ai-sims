import {
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  DstColorFactor,
  Float32BufferAttribute,
  MeshBasicMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Ray,
  SkinnedMesh,
  Vector3,
  Vector4,
  ZeroFactor,
  type Material,
  type Texture,
} from 'three';

import type { TattooDesign, TattooPlacement } from '@/features/creator/tattoos';

import type { BodyRig } from './assembly';
import { BODY_HIDDEN } from './garments';
import type { SkinTuning, UnderwearUniforms } from './materials';
import { atRest, restJoint, sampleRest, type RestSample } from './restPose';
import { FINEST_OPACITY, LEG_HEIGHT, SHEER_CURVE, type SockWear } from './socks';
import { atlasCell, tattooAtlas } from './tattooAtlas';

/**
 * Small tattoos as decals: the skin triangles under a design are copied into a
 * patch that is skinned, morphed and placed exactly like the skin it came
 * from, and drawn over it with the ink multiplied in. The skin materials stay
 * as they are (the head's already uses every texture unit WebGL guarantees).
 * The design's coordinates come from the patch itself, projected around the
 * spot it sits on, so a UV seam under it does not matter.
 */

export interface TattooWear {
  design: TattooDesign;
  placement: TattooPlacement;
}

/** Where a placement sits: a ray from inside the limb out to the skin. */
export interface PlacementRay {
  origin: Vector3;
  direction: Vector3;
  /** Points to the top of the design (projected onto the skin). */
  up: Vector3;
  /** Width and height of the design on the skin (m). */
  size: number;
}

/** A joint's position at rest (world), or null when the skeleton lacks it. */
export type JointLookup = (name: string) => Vector3 | null;

const DEG = Math.PI / 180;

/**
 * The character's own axes from its shoulders: left, up (the turntable only
 * turns about up) and forward.
 */
export function bodyFrame(joint: JointLookup) {
  const left = joint('upperarm_l');
  const right = joint('upperarm_r');
  if (!left || !right) return null;
  const lateral = left.sub(right).setY(0).normalize();
  const up = new Vector3(0, 1, 0);
  const forward = new Vector3().crossVectors(lateral, up);
  return { left: lateral, up, forward };
}

/** Unit `v` with its component along unit `axis` removed. */
const across = (v: Vector3, axis: Vector3) => v.addScaledVector(axis, -v.dot(axis)).normalize();

/**
 * Forearm spot on the side the palm faces (volar) or the back of the hand
 * (dorsal), turned towards the thumb by `towardsThumb` so a hanging arm shows
 * it to the camera. `along` is how far from the elbow to the wrist.
 */
function forearmRay(
  joint: JointLookup,
  side: 'l' | 'r',
  along: number,
  face: 'volar' | 'dorsal',
  towardsThumb: number,
  size: number,
): PlacementRay | null {
  const elbow = joint(`lowerarm_${side}`);
  const hand = joint(`hand_${side}`);
  const index = joint(`index_01_${side}`);
  const pinky = joint(`pinky_01_${side}`);
  const middle = joint(`middle_01_${side}`);
  const thumb = joint(`thumb_01_${side}`);
  if (!elbow || !hand || !index || !pinky || !middle || !thumb) return null;
  const axis = hand.clone().sub(elbow).normalize();
  // Across the knuckles towards the thumb, then down the hand: for a left
  // hand that cross product leaves the back of the hand, for a right the palm.
  const knuckles = index.sub(pinky);
  const dorsal = across(
    new Vector3().crossVectors(knuckles, middle.sub(hand)).multiplyScalar(side === 'l' ? 1 : -1),
    axis,
  );
  const normal = face === 'dorsal' ? dorsal : dorsal.negate();
  const radial = across(thumb.sub(hand), axis);
  const direction = normal
    .multiplyScalar(Math.cos(towardsThumb))
    .addScaledVector(radial, Math.sin(towardsThumb))
    .normalize();
  return {
    origin: elbow.clone().lerp(hand, along),
    direction,
    up: axis.negate(),
    size,
  };
}

/** The ray for a placement, from the rest joints; null when a joint is missing. */
export function placementRay(placement: TattooPlacement, joint: JointLookup): PlacementRay | null {
  const frame = bodyFrame(joint);
  if (!frame) return null;
  const { left, up, forward } = frame;
  const at = (name: string, offsets: [Vector3, number][]) => {
    const origin = joint(name);
    if (!origin) return null;
    for (const [axis, distance] of offsets) origin.addScaledVector(axis, distance);
    return origin;
  };
  const ray = (origin: Vector3 | null, direction: Vector3, size: number): PlacementRay | null =>
    origin ? { origin, direction: direction.normalize(), up: up.clone(), size } : null;

  switch (placement) {
    // Left inner wrist, well towards the thumb (a hanging arm hides the palm
    // side against the thigh); its top towards the elbow.
    case 'innerWrist':
      return forearmRay(joint, 'l', 0.82, 'volar', 75 * DEG, 0.026);
    // Right forearm, outer side halfway up.
    case 'forearm':
      return forearmRay(joint, 'r', 0.5, 'dorsal', 45 * DEG, 0.045);
    // Under the inner end of the left collarbone, inside the underwear strap.
    case 'collarbone':
      return ray(
        at('spine_05', [
          [left, 0.05],
          [up, 0.055],
        ]),
        forward.clone().addScaledVector(up, 0.25).addScaledVector(left, 0.15),
        0.032,
      );
    // On the bone just behind the right ear (the face rig's ear root), a
    // little under its middle.
    case 'behindEar':
      return ray(
        at('FACIAL_R_Ear', [
          [up, -0.01],
          [left, 0.015],
          [forward, -0.01],
        ]),
        left
          .clone()
          .multiplyScalar(-Math.cos(60 * DEG))
          .addScaledVector(forward, -Math.sin(60 * DEG)),
        0.018,
      );
    // Over the left outer ankle bone, turned a little to the front.
    case 'ankle':
      return ray(
        at('foot_l', [[up, 0.045]]),
        left
          .clone()
          .multiplyScalar(Math.cos(30 * DEG))
          .addScaledVector(forward, Math.sin(30 * DEG)),
        0.026,
      );
    // On the upper outer corner of the right shoulder blade, outside the
    // back of the women's underwear top.
    case 'shoulderBlade':
      return ray(
        at('spine_05', [
          [left, -0.135],
          [up, 0.08],
        ]),
        forward.clone().negate().addScaledVector(left, -0.15),
        0.055,
      );
    // At the back of the neck, above the top vertebra.
    case 'nape':
      return ray(
        at('neck_01', [[forward, 0.01]]),
        forward.clone().negate().addScaledVector(up, 0.1),
        0.024,
      );
  }
}

/** Where a ray leaves the skin: the point, the triangle's outward normal. */
export interface SkinHit {
  point: Vector3;
  normal: Vector3;
  /** The mesh sample the hit triangle belongs to, and its corners (outward winding). */
  sample: RestSample;
  corners: [number, number, number];
}

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _hit = new Vector3();
const _ab = new Vector3();
const _ac = new Vector3();

function triangleCorners(sample: RestSample, index: ArrayLike<number>, t: number): boolean {
  const i = index[t]!;
  const j = index[t + 1]!;
  const k = index[t + 2]!;
  if (!sample.sampled[i] || !sample.sampled[j] || !sample.sampled[k]) return false;
  _a.fromArray(sample.positions, i * 3);
  _b.fromArray(sample.positions, j * 3);
  _c.fromArray(sample.positions, k * 3);
  return true;
}

function indexOf(sample: RestSample): ArrayLike<number> {
  const index = sample.mesh.geometry.index;
  if (index) return index.array;
  return Uint32Array.from(
    { length: sample.mesh.geometry.getAttribute('position').count },
    (_, i) => i,
  );
}

/** The first skin the ray meets (it starts inside the body); null if none. */
export function castToSkin(samples: readonly RestSample[], ray: PlacementRay): SkinHit | null {
  const caster = new Ray(ray.origin, ray.direction);
  let best = Infinity;
  let hit: SkinHit | null = null;
  for (const sample of samples) {
    const index = indexOf(sample);
    for (let t = 0; t + 2 < index.length; t += 3) {
      if (!triangleCorners(sample, index, t)) continue;
      if (!caster.intersectTriangle(_a, _b, _c, false, _hit)) continue;
      const distance = _hit.distanceTo(ray.origin);
      if (distance >= best) continue;
      best = distance;
      const normal = new Vector3().crossVectors(_ab.subVectors(_b, _a), _ac.subVectors(_c, _a));
      normal.normalize();
      const outward = normal.dot(ray.direction) >= 0;
      if (!outward) normal.negate();
      const corners: [number, number, number] = outward
        ? [index[t]!, index[t + 1]!, index[t + 2]!]
        : [index[t]!, index[t + 2]!, index[t + 1]!];
      hit = { point: _hit.clone(), normal, sample, corners };
    }
  }
  return hit;
}

/** The design's frame on the skin: its right and top, both along the skin. */
export function decalFrame(normal: Vector3, up: Vector3): { right: Vector3; top: Vector3 } {
  const top = across(up.clone(), normal);
  const right = new Vector3().crossVectors(top, normal);
  return { right, top };
}

/**
 * Design coordinates of a point near the spot: projected onto the skin's
 * tangent plane, then stretched back to its straight distance from the spot,
 * which follows a curved limb far better than the plain projection. 0..1
 * across the design, (0.5, 0.5) at the spot.
 */
export function decalUv(
  point: Vector3,
  spot: Vector3,
  normal: Vector3,
  frame: { right: Vector3; top: Vector3 },
  size: number,
  target: [number, number],
): [number, number] {
  const offset = _ab.subVectors(point, spot);
  const length = offset.length();
  offset.addScaledVector(normal, -offset.dot(normal));
  const flat = offset.length();
  if (flat > 1e-9) offset.multiplyScalar(length / flat);
  target[0] = offset.dot(frame.right) / size + 0.5;
  target[1] = offset.dot(frame.top) / size + 0.5;
  return target;
}

/** A patch covers the design's square with this much room around it. */
const PATCH_REACH = 0.8;
/** Triangles turned further than this from the spot's normal are the far side of a limb. */
const PATCH_FACING = 0.2;
/**
 * Skin standing out of the spot's tangent plane by more than this (m) is not
 * under the design but beside it (the back of an ear next to the spot behind
 * it). Skin around a spot curves away, below the plane.
 */
const PATCH_RISE = 0.004;

/** Skin triangles of one mesh under a design, as a patch geometry (null if none). */
export function patchGeometry(
  sample: RestSample,
  hit: SkinHit,
  ray: PlacementRay,
): BufferGeometry | null {
  const source = sample.mesh.geometry;
  const index = indexOf(sample);
  const frame = decalFrame(hit.normal, ray.up);
  const reach = ray.size * PATCH_REACH;
  const triangles: number[] = [];
  for (let t = 0; t + 2 < index.length; t += 3) {
    if (!triangleCorners(sample, index, t)) continue;
    const centre = _hit
      .copy(_a)
      .add(_b)
      .add(_c)
      .multiplyScalar(1 / 3);
    if (centre.distanceTo(hit.point) > reach) continue;
    const normal = _ab.subVectors(_b, _a).cross(_ac.subVectors(_c, _a)).normalize();
    if (normal.dot(hit.normal) < PATCH_FACING) continue;
    const rise = Math.max(
      _ab.subVectors(_a, hit.point).dot(hit.normal),
      _ab.subVectors(_b, hit.point).dot(hit.normal),
      _ab.subVectors(_c, hit.point).dot(hit.normal),
    );
    if (rise > PATCH_RISE) continue;
    triangles.push(index[t]!, index[t + 1]!, index[t + 2]!);
  }
  if (triangles.length === 0) return null;

  const remap = new Map<number, number>();
  const vertices: number[] = [];
  const patchIndex = triangles.map((v) => {
    let n = remap.get(v);
    if (n === undefined) {
      n = vertices.length;
      remap.set(v, n);
      vertices.push(v);
    }
    return n;
  });
  const geometry = new BufferGeometry();
  geometry.setIndex(patchIndex);
  for (const name of ['position', 'normal', 'skinIndex', 'skinWeight', BODY_HIDDEN, LEG_HEIGHT]) {
    const attribute = source.getAttribute(name);
    if (attribute) geometry.setAttribute(name, copyVertices(attribute, vertices));
  }
  // The skin's own UV, for the underwear drawn on it.
  const skinUv = source.getAttribute('uv');
  if (skinUv) geometry.setAttribute(TATTOO_SKIN_UV, copyVertices(skinUv, vertices));
  for (const name of ['position', 'normal'] as const) {
    const targets = source.morphAttributes[name];
    if (targets) geometry.morphAttributes[name] = targets.map((t) => copyVertices(t, vertices));
  }
  geometry.morphTargetsRelative = source.morphTargetsRelative;
  const uv = new Float32Array(vertices.length * 2);
  const point = new Vector3();
  const pair: [number, number] = [0, 0];
  vertices.forEach((v, n) => {
    point.fromArray(sample.positions, v * 3);
    decalUv(point, hit.point, hit.normal, frame, ray.size, pair);
    uv[n * 2] = pair[0];
    uv[n * 2 + 1] = pair[1];
  });
  geometry.setAttribute(TATTOO_UV, new Float32BufferAttribute(uv, 2));
  geometry.userData.tattooSource = Uint32Array.from(vertices);
  return geometry;
}

type AnyAttribute = Parameters<BufferGeometry['setAttribute']>[1];

function copyVertices(attribute: AnyAttribute, vertices: readonly number[]): BufferAttribute {
  const size = attribute.itemSize;
  // Skin indices stay integers; everything else (quantized weights and
  // morphs included) is copied as plain floats, which getComponent decodes.
  const integer =
    !attribute.normalized &&
    (attribute.array instanceof Uint16Array || attribute.array instanceof Uint8Array);
  const out = integer
    ? new Uint16Array(vertices.length * size)
    : new Float32Array(vertices.length * size);
  vertices.forEach((v, n) => {
    for (let k = 0; k < size; k += 1) out[n * size + k] = attribute.getComponent(v, k);
  });
  return new BufferAttribute(out, size);
}

/** Per-vertex design coordinates of a patch. */
export const TATTOO_UV = 'tattooUv';
/** The skin atlas UV of a patch's vertices. */
const TATTOO_SKIN_UV = 'tattooSkinUv';

/** Fine-line ink: blue-black, a little under full darkness once healed. */
const INK = new Vector3(0.02, 0.024, 0.038);
const INK_STRENGTH = 0.74;

const TATTOO_VERTEX_PARS = /* glsl */ `
attribute vec2 ${TATTOO_UV};
varying vec2 vTattooUv;
#ifdef MH_TATTOO_UNDERWEAR
attribute vec2 ${TATTOO_SKIN_UV};
varying vec2 vTattooSkinUv;
#endif
#ifdef MH_TATTOO_BODY
attribute float ${BODY_HIDDEN};
attribute float ${LEG_HEIGHT};
varying float vTattooHidden;
varying float vTattooLeg;
#endif
`;
const TATTOO_VERTEX = /* glsl */ `
vTattooUv = ${TATTOO_UV};
#ifdef MH_TATTOO_UNDERWEAR
vTattooSkinUv = ${TATTOO_SKIN_UV};
#endif
#ifdef MH_TATTOO_BODY
vTattooHidden = ${BODY_HIDDEN};
vTattooLeg = ${LEG_HEIGHT};
#endif
`;
const TATTOO_FRAGMENT_PARS = /* glsl */ `
uniform sampler2D tattooAtlas;
uniform vec4 tattooCell;
uniform vec3 tattooInk;
uniform float tattooStrength;
uniform float tattooSockTop;
uniform float tattooSockCover;
varying vec2 vTattooUv;
#ifdef MH_TATTOO_BODY
varying float vTattooHidden;
varying float vTattooLeg;
#endif
#ifdef MH_TATTOO_UNDERWEAR
varying vec2 vTattooSkinUv;
uniform vec2 skinUnderwearShow;
#endif
#ifdef MH_UNDERWEAR_CLOTH
uniform sampler2D skinUnderwearMask;
#endif
#ifdef MH_UNDERWEAR_STRAPS
uniform sampler2D skinUnderwearStraps;
uniform float skinUnderwearHasStraps;
#endif
`;
// The ink lowers the skin's albedo: drawn over the lit skin, multiplied in
// (CustomBlending: dst * (src.rgb premultiplied) + dst * (1 - src.a)).
const TATTOO_FRAGMENT = /* glsl */ `
if ( any( lessThan( vTattooUv, vec2( 0.0 ) ) ) || any( greaterThan( vTattooUv, vec2( 1.0 ) ) ) ) discard;
float tattooInkCover = texture2D( tattooAtlas, tattooCell.xy + vTattooUv * tattooCell.zw ).r * tattooStrength;
#ifdef MH_TATTOO_BODY
if ( vTattooHidden > 0.5 ) discard;
if ( vTattooLeg < tattooSockTop ) tattooInkCover *= 1.0 - tattooSockCover;
#endif
// Underwear is drawn on the skin (see ./materials.ts): ink stays under it.
#ifdef MH_UNDERWEAR_CLOTH
vec2 tattooUnderwear = texture2D( skinUnderwearMask, vTattooSkinUv ).rg * skinUnderwearShow;
tattooInkCover *= 1.0 - max( tattooUnderwear.r, tattooUnderwear.g );
#endif
#ifdef MH_UNDERWEAR_STRAPS
tattooInkCover *= 1.0 - texture2D( skinUnderwearStraps, vTattooSkinUv ).a * skinUnderwearShow.x * skinUnderwearHasStraps;
#endif
if ( tattooInkCover < 0.004 ) discard;
diffuseColor = vec4( tattooInk, tattooInkCover );
`;

export interface TattooUniforms {
  tattooAtlas: { value: Texture | null };
  tattooCell: { value: Vector4 };
  tattooInk: { value: Vector3 };
  tattooStrength: { value: number };
  /** Rest height (m) under which socks or tights cover the leg; -1 for none. */
  tattooSockTop: { value: number };
  /** How much of the ink the socks hide (1 cotton, less for sheer tights). */
  tattooSockCover: { value: number };
}

/**
 * The ink of a design. `underwear` are the uniforms of the skin it is cut from
 * (shared, so they follow the skin's), `cloth` for the body, `straps` for the head.
 */
export function tattooMaterial(
  design: TattooDesign,
  body: boolean,
  underwear: { uniforms: UnderwearUniforms; kind: 'cloth' | 'straps' } | null = null,
): MeshBasicMaterial {
  const cell = atlasCell(design);
  const uniforms: TattooUniforms = {
    tattooAtlas: { value: tattooAtlas() },
    tattooCell: { value: new Vector4(cell.u, cell.v, cell.width, cell.height) },
    tattooInk: { value: INK.clone() },
    tattooStrength: { value: INK_STRENGTH },
    tattooSockTop: { value: -1 },
    tattooSockCover: { value: 1 },
  };
  const material = new MeshBasicMaterial({
    name: `tattoo_${design}`,
    transparent: true,
    depthWrite: false,
    // Drawn on the very skin it was cut from: pulled a hair towards the eye.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    toneMapped: false,
    fog: false,
    premultipliedAlpha: true,
    blending: CustomBlending,
    blendSrc: DstColorFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
  });
  material.defines = {
    ...material.defines,
    ...(body ? { MH_TATTOO_BODY: '' } : {}),
    ...(underwear ? { MH_TATTOO_UNDERWEAR: '' } : {}),
    ...(underwear?.kind === 'cloth' ? { MH_UNDERWEAR_CLOTH: '' } : {}),
    ...(underwear?.kind === 'straps' ? { MH_UNDERWEAR_STRAPS: '' } : {}),
  };
  material.userData.tattooUniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, underwear?.uniforms ?? {});
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${TATTOO_VERTEX_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${TATTOO_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${TATTOO_FRAGMENT_PARS}`)
      .replace('#include <map_fragment>', TATTOO_FRAGMENT);
  };
  material.customProgramCacheKey = () =>
    `mh-tattoo-v2${body ? '-body' : ''}${underwear ? `-underwear-${underwear.kind}` : ''}`;
  return material;
}

/** A worn tattoo: its patches (one per skin mesh it covers) and their materials. */
export interface WornTattoo {
  wear: TattooWear;
  patches: SkinnedMesh[];
}

/** Skin meshes a tattoo can be cut from: the body, and the head (face at rest). */
export interface TattooSkins {
  body: BodyRig;
  head: SkinnedMesh | undefined;
}

/** Vertices further than this (m) from a placement's ray origin are never searched. */
const SEARCH_RADIUS = 0.25;

function patchMesh(source: SkinnedMesh, geometry: BufferGeometry, design: TattooDesign) {
  const skin = (Array.isArray(source.material) ? source.material[0] : source.material) as
    Material | undefined;
  const underwearUniforms = skin?.userData.underwearUniforms as UnderwearUniforms | null;
  const tuning = skin?.userData.skinTuning as SkinTuning | undefined;
  const underwear =
    underwearUniforms && tuning?.underwear && geometry.getAttribute(TATTOO_SKIN_UV)
      ? { uniforms: underwearUniforms, kind: tuning.underwear }
      : null;
  const patch = new SkinnedMesh(
    geometry,
    tattooMaterial(design, Boolean(geometry.getAttribute(LEG_HEIGHT)), underwear),
  );
  patch.name = `tattoo_${design}`;
  patch.position.copy(source.position);
  patch.quaternion.copy(source.quaternion);
  patch.scale.copy(source.scale);
  patch.morphTargetInfluences = source.morphTargetInfluences;
  patch.morphTargetDictionary = source.morphTargetDictionary;
  patch.bind(source.skeleton, source.bindMatrix);
  patch.frustumCulled = false;
  patch.castShadow = false;
  patch.receiveShadow = false;
  // The body rebinds whenever the sliders move: follow it, like the garments.
  patch.onBeforeRender = () => {
    patch.bindMatrix.copy(source.bindMatrix);
    patch.bindMatrixInverse.copy(source.bindMatrixInverse);
  };
  source.parent?.add(patch);
  return patch;
}

/**
 * Puts the tattoos on: measures each placement on the resting skin and adds
 * its patches next to the meshes they were cut from. A placement that finds
 * no skin (a joint missing, a ray that misses) is skipped.
 */
export function wearTattoos(skins: TattooSkins, wears: readonly TattooWear[]): WornTattoo[] {
  if (wears.length === 0) return [];
  return atRest(skins.body, () =>
    wears.flatMap((wear) => {
      const ray = placementRay(wear.placement, (name) => restJoint(skins.body, name, skins.head));
      if (!ray) return [];
      const samples = [
        sampleRest(skins.body.mesh, ray.origin, SEARCH_RADIUS, true),
        ...(skins.head ? [sampleRest(skins.head, ray.origin, SEARCH_RADIUS, false)] : []),
      ];
      const hit = castToSkin(samples, ray);
      if (!hit) return [];
      const patches = samples.flatMap((sample) => {
        const geometry = patchGeometry(sample, hit, ray);
        return geometry ? [patchMesh(sample.mesh, geometry, wear.design)] : [];
      });
      return patches.length > 0 ? [{ wear, patches }] : [];
    }),
  );
}

/** The skin triangle in the middle of a placement, for the camera to frame. */
export interface TattooSpot {
  mesh: SkinnedMesh;
  /** Its corners, wound so that (b - a) x (c - a) points out of the skin. */
  corners: [number, number, number];
}

const _p = [new Vector3(), new Vector3(), new Vector3()] as const;

/** Where a spot is this frame (world): its centre and outward normal. */
export function posedSpot(spot: TattooSpot, point: Vector3, normal: Vector3): void {
  spot.corners.forEach((vertex, k) =>
    spot.mesh.getVertexPosition(vertex, _p[k]).applyMatrix4(spot.mesh.matrixWorld),
  );
  const [a, b, c] = _p;
  point
    .copy(a)
    .add(b)
    .add(c)
    .multiplyScalar(1 / 3);
  normal.crossVectors(_ab.subVectors(b, a), _ac.subVectors(c, a)).normalize();
}

/** Where a placement lands on this character's skin (tattooed there or not). */
export function findSpot(skins: TattooSkins, placement: TattooPlacement): TattooSpot | null {
  return atRest(skins.body, () => {
    const ray = placementRay(placement, (name) => restJoint(skins.body, name, skins.head));
    if (!ray) return null;
    const samples = [
      sampleRest(skins.body.mesh, ray.origin, SEARCH_RADIUS, true),
      ...(skins.head ? [sampleRest(skins.head, ray.origin, SEARCH_RADIUS, false)] : []),
    ];
    const hit = castToSkin(samples, ray);
    return hit ? { mesh: hit.sample.mesh, corners: hit.corners } : null;
  });
}

/** Takes tattoos off and frees their patches. */
export function takeOffTattoos(worn: readonly WornTattoo[]): void {
  for (const tattoo of worn) {
    for (const patch of tattoo.patches) {
      patch.removeFromParent();
      patch.geometry.dispose();
      (patch.material as MeshBasicMaterial).dispose();
    }
  }
}

/**
 * Re-reads which body skin the garments hide (their mask changes with every
 * outfit): ink under clothes is not drawn.
 */
export function syncTattooHide(worn: readonly WornTattoo[], body: SkinnedMesh): void {
  const hidden = body.geometry.getAttribute(BODY_HIDDEN);
  for (const tattoo of worn) {
    for (const patch of tattoo.patches) {
      const own = patch.geometry.getAttribute(BODY_HIDDEN) as BufferAttribute | undefined;
      const source = patch.geometry.userData.tattooSource as Uint32Array | undefined;
      if (!own || !source || patch.skeleton !== body.skeleton) continue;
      for (let n = 0; n < source.length; n += 1) own.setX(n, hidden ? hidden.getX(source[n]!) : 0);
      own.needsUpdate = true;
    }
  }
}

/**
 * Whether a garment's skin mask (BODY_HIDDEN, per body vertex) covers any of a
 * tattoo's body skin: it hides the tattoo.
 */
export function hidesTattoo(
  hide: Uint8Array | null | undefined,
  tattoo: WornTattoo,
  body: SkinnedMesh,
): boolean {
  if (!hide) return false;
  for (const patch of tattoo.patches) {
    const source = patch.geometry.userData.tattooSource as Uint32Array | undefined;
    if (!source || patch.skeleton !== body.skeleton) continue;
    for (const vertex of source) if (hide[vertex]) return true;
  }
  return false;
}

/** Socks and tights cover ink on the leg: all of it, or tights some of it. */
export function setTattooSocks(worn: readonly WornTattoo[], socks: SockWear | null): void {
  const cover = !socks
    ? 0
    : socks.fabric === 'cotton'
      ? 1
      : 1 - (1 - FINEST_OPACITY) * socks.sheer ** SHEER_CURVE;
  for (const tattoo of worn) {
    for (const patch of tattoo.patches) {
      const uniforms = (patch.material as MeshBasicMaterial).userData.tattooUniforms as
        TattooUniforms | undefined;
      if (!uniforms) continue;
      uniforms.tattooSockTop.value = socks ? socks.top : -1;
      uniforms.tattooSockCover.value = cover;
    }
  }
}
