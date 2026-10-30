import {
  BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  Quaternion,
  SkinnedMesh,
  Vector3,
  type Bone,
  type BufferGeometry,
  type Object3D,
} from 'three';

import { findAccessory } from '@/features/avatar/accessories/catalog';
import { JewelleryMaterials } from '@/features/avatar/accessories/materials';
import {
  LOOP_FIT,
  loopPiece,
  pinnedPiece,
  type PiecePart,
  type PinnedPiece,
} from '@/features/avatar/accessories/pieces';

import type { BodyRig } from './assembly';
import { BODY_HIDDEN } from './garments';
import { atRest, restJoint, sampleRest, type RestSample } from './restPose';
import { bodyFrame, castToSkin, type JointLookup, type SkinHit } from './tattoos';

/**
 * Jewellery on a MetaHuman. Earrings and piercings are pinned to a skin
 * triangle and follow it every frame through the face morphs and the
 * skeleton (lip-sync, expressions); what hangs from them swings under gravity.
 * Necklaces, bracelets and rings are built around the resting neck, wrist or
 * finger and skinned like the skin under them, so they move with it and keep
 * their distance from it.
 */

export interface JewellerySkins {
  body: BodyRig;
  head: SkinnedMesh | undefined;
}

export interface WornJewellery {
  /** Moves pinned pieces onto their skin and swings what hangs (every frame). */
  update: (delta: number) => void;
  /** Hides pieces whose skin a garment covers (after every outfit change). */
  syncHidden: (body: SkinnedMesh) => void;
  dispose: () => void;
}

/** A skin point a pinned piece sits on: a triangle (wound outwards) and its weights. */
interface SkinPoint {
  mesh: SkinnedMesh;
  corners: [number, number, number];
  weights: [number, number, number];
}

interface Pin {
  at: SkinPoint;
  object: Group;
  /** The bone that carries "up" for the piece, and up in its frame. */
  bone: Bone;
  upLocal: Vector3;
  hanging?: {
    object: Group;
    pivot: Vector3;
    length: number;
    tip: Vector3;
    previous: Vector3;
    ready: boolean;
  };
}

interface Loop {
  meshes: SkinnedMesh[];
  /** Body vertices the loop's centre line was skinned from. */
  bodyVertices: number[];
}

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _p = new Vector3();
const _n = new Vector3();
const _x = new Vector3();
const _y = new Vector3();
const _m = new Matrix4();
const _inverse = new Matrix4();
const _q = new Quaternion();

/** A pinned piece's skin faces its outward direction within ~70 degrees. */
const FACING = 0.35;

/** The skin point nearest `target` (world, at rest) facing within ~70 degrees of `out`. */
export function nearestSkinPoint(
  samples: readonly RestSample[],
  target: Vector3,
  out: Vector3,
): SkinPoint | null {
  let best = Infinity;
  let found: SkinPoint | null = null;
  for (const sample of samples) {
    const index = sample.mesh.geometry.index;
    if (!index) continue;
    for (let t = 0; t + 2 < index.count; t += 3) {
      const i = index.getX(t);
      const j = index.getX(t + 1);
      const k = index.getX(t + 2);
      if (!sample.sampled[i] || !sample.sampled[j] || !sample.sampled[k]) continue;
      _a.fromArray(sample.positions, i * 3);
      _b.fromArray(sample.positions, j * 3);
      _c.fromArray(sample.positions, k * 3);
      _n.subVectors(_b, _a).cross(_x.subVectors(_c, _a));
      const area = _n.length();
      if (area < 1e-12) continue;
      _n.divideScalar(area);
      // Only skin facing the way the piece looks: the near side of a thin
      // flap (an earlobe, the rim of an ear), never its back.
      const facing = _n.dot(out);
      if (facing < FACING) continue;
      // Barycentric closest point (clamped to the triangle by its centroid blend).
      _p.copy(_a)
        .add(_b)
        .add(_c)
        .multiplyScalar(1 / 3);
      const distance = _p.distanceToSquared(target);
      if (distance >= best) continue;
      best = distance;
      found = { mesh: sample.mesh, corners: [i, j, k], weights: [1 / 3, 1 / 3, 1 / 3] };
    }
  }
  return found;
}

/** Where a skin point is this frame (world): position and outward normal. */
function posePoint(point: SkinPoint, position: Vector3, normal: Vector3): void {
  const { mesh, corners, weights } = point;
  mesh.getVertexPosition(corners[0], _a).applyMatrix4(mesh.matrixWorld);
  mesh.getVertexPosition(corners[1], _b).applyMatrix4(mesh.matrixWorld);
  mesh.getVertexPosition(corners[2], _c).applyMatrix4(mesh.matrixWorld);
  position
    .set(0, 0, 0)
    .addScaledVector(_a, weights[0])
    .addScaledVector(_b, weights[1])
    .addScaledVector(_c, weights[2]);
  normal.subVectors(_b, _a).cross(_x.subVectors(_c, _a)).normalize();
}

/** Where each pinned item sits: the anchor on the skin, the side it faces, the bone that carries it. */
interface PinSpot {
  head: boolean;
  target: Vector3;
  out: Vector3;
  bone: string;
  /** Mirrored left to right (the right ear's piece). */
  mirror?: boolean;
}

function pinSpots(slot: string, id: string, joint: JointLookup): PinSpot[] {
  const frame = bodyFrame(joint);
  if (!frame) return [];
  const { left, up, forward } = frame;
  const face = (name: string, offsets: [Vector3, number][], out: Vector3, mirror = false) => {
    const target = joint(name);
    if (!target) return [];
    for (const [axis, distance] of offsets) target.addScaledVector(axis, distance);
    return [{ head: true, target, out: out.normalize(), bone: 'head', mirror }];
  };
  const right = left.clone().negate();
  switch (slot) {
    case 'ears':
      return [
        ...face('FACIAL_L_Ear4', [[up, -0.004]], left.clone()),
        ...face('FACIAL_R_Ear4', [[up, -0.004]], right.clone(), true),
      ];
    case 'helix':
      if (id === 'tragus-stud') {
        return face(
          'FACIAL_L_Ear',
          [
            [forward, 0.012],
            [left, 0.004],
          ],
          left.clone().addScaledVector(forward, 0.6),
        );
      }
      if (id === 'helix-studs') {
        const top = joint('FACIAL_L_Ear2');
        const back = joint('FACIAL_L_Ear3');
        if (!top || !back) return [];
        // The rig's rim joints sit at its back: the studs go on its front.
        return [0.15, 0.45, 0.75].map((t) => ({
          head: true,
          target: top.clone().lerp(back, t).addScaledVector(forward, 0.006),
          out: left.clone().addScaledVector(forward, 0.5).addScaledVector(up, 0.2).normalize(),
          bone: 'head',
        }));
      }
      return face('FACIAL_L_Ear2', [[forward, 0.004]], left.clone().addScaledVector(up, 0.4));
    case 'nose':
      if (id === 'nose-septum') {
        return face(
          'FACIAL_C_NoseTip',
          [
            [up, -0.012],
            [forward, -0.006],
          ],
          up.clone().negate().addScaledVector(forward, 0.3),
        );
      }
      return face('FACIAL_L_Nostril', [], left.clone().addScaledVector(forward, 1));
    case 'brow':
      return face(
        'FACIAL_L_Eye',
        [
          [up, 0.005],
          [left, 0.02],
          [forward, 0.006],
        ],
        forward.clone().addScaledVector(left, 0.5).addScaledVector(up, 0.2),
      );
    case 'lip':
      return face('FACIAL_C_LipLowerSkin', [[up, 0.002]], forward.clone());
    case 'navel': {
      const low = joint('spine_01');
      const high = joint('spine_02');
      if (!low || !high) return [];
      return [{ head: false, target: low.lerp(high, 0.3), out: forward.clone(), bone: 'spine_01' }];
    }
    default:
      return [];
  }
}

function buildParts(parts: readonly PiecePart[], materials: JewelleryMaterials, parent: Object3D) {
  for (const piece of parts) {
    const mesh = new Mesh(piece.geometry, materials.get(piece.finish, piece.color));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
  }
}

/** Piece geometry mirrored across x (for the right-hand side's copy). */
function mirrored(piece: PinnedPiece): PinnedPiece {
  const flip = (parts: PiecePart[]) =>
    parts.map((p) => {
      const geometry = p.geometry.clone().scale(-1, 1, 1);
      // Mirroring turns the faces inside out; put the winding back.
      const index = geometry.index;
      if (index) {
        for (let t = 0; t + 2 < index.count; t += 3) {
          const b = index.getX(t + 1);
          index.setX(t + 1, index.getX(t + 2));
          index.setX(t + 2, b);
        }
      }
      geometry.computeVertexNormals();
      return { ...p, geometry };
    });
  return {
    parts: flip(piece.parts),
    hanging: piece.hanging ? { ...piece.hanging, parts: flip(piece.hanging.parts) } : undefined,
  };
}

/** Skin weights of a sampled vertex, on the body skeleton (head bones mapped by name). */
function bodyWeights(
  mesh: SkinnedMesh,
  vertex: number,
  body: SkinnedMesh,
  bodyIndex: Map<string, number>,
): { index: number[]; weight: number[] } {
  const skinIndex = mesh.geometry.getAttribute('skinIndex');
  const skinWeight = mesh.geometry.getAttribute('skinWeight');
  const index: number[] = [];
  const weight: number[] = [];
  for (let k = 0; k < 4; k += 1) {
    let bone: Object3D | null = mesh.skeleton.bones[skinIndex.getComponent(vertex, k)] ?? null;
    if (mesh !== body) {
      while (bone && !bodyIndex.has(bone.name)) bone = bone.parent;
    }
    index.push(bone ? (bodyIndex.get(bone.name) ?? skinIndex.getComponent(vertex, k)) : 0);
    weight.push(skinWeight.getComponent(vertex, k));
  }
  return { index, weight };
}

/** The nearest sampled vertex to a point, over several samples. */
function nearestVertex(samples: readonly RestSample[], point: Vector3) {
  let best = Infinity;
  let found: { sample: RestSample; vertex: number } | null = null;
  for (const sample of samples) {
    const { positions, sampled } = sample;
    for (let v = 0; v < sampled.length; v += 1) {
      if (!sampled[v]) continue;
      const dx = positions[v * 3]! - point.x;
      const dy = positions[v * 3 + 1]! - point.y;
      const dz = positions[v * 3 + 2]! - point.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best) {
        best = d;
        found = { sample, vertex: v };
      }
    }
  }
  return found;
}

/** Half widths (m) of the ellipse a necklace rests on around the neck's base. */
const NECK_SIDE = 0.068;
const NECK_BACK = 0.072;
const NECK_FRONT = 0.07;
/** Height (m) of a choker above the neck joint: halfway up the neck. */
const CHOKER_HEIGHT = 0.032;
/** Height (m) above the neck joint the sides are dropped from: under the jaw and the ears. */
const DROP_FROM = 0.04;

/** A centre line around the neck, wrist or finger (world, at rest) and the skin's normals. */
function loopLine(
  id: string,
  skins: JewellerySkins,
  joint: JointLookup,
): { path: Vector3[]; normals: Vector3[]; samples: RestSample[]; dorsal?: Vector3 } | null {
  const def = findAccessory(id);
  const fit = LOOP_FIT[id];
  const frame = bodyFrame(joint);
  if (!def || !fit || !frame) return null;
  const { left, up, forward } = frame;
  const offset = fit.clearance + fit.thickness;
  const path: Vector3[] = [];
  const normals: Vector3[] = [];

  if (def.slot === 'neck') {
    const neck = joint('neck_01');
    if (!neck) return null;
    const samples = [
      sampleRest(skins.body.mesh, neck, 0.26, true),
      ...(skins.head ? [sampleRest(skins.head, neck, 0.26, false)] : []),
    ];
    const steps = 72;
    for (let s = 0; s < steps; s += 1) {
      const theta = (s / steps) * Math.PI * 2;
      const sin = Math.sin(theta);
      const cos = Math.cos(theta);
      const across = forward.clone().multiplyScalar(cos).addScaledVector(left, sin);
      let hit: SkinHit | null;
      if (fit.choker) {
        hit = castToSkin(samples, {
          origin: neck.clone().setY(neck.y + CHOKER_HEIGHT),
          direction: across,
          up,
          size: 0,
        });
      } else {
        // Rests on the base of the neck and the trapezius: dropped from under
        // the jaw onto an ellipse just outside the neck.
        const radius = 1 / Math.hypot(sin / NECK_SIDE, cos / (cos > 0 ? NECK_FRONT : NECK_BACK));
        hit = castToSkin(samples, {
          origin: neck
            .clone()
            .addScaledVector(across, radius)
            .setY(neck.y + DROP_FROM),
          direction: up.clone().negate(),
          up,
          size: 0,
        });
        // castToSkin turns the normal along the ray; from above, out is up.
        hit?.normal.negate();
        // The front hangs lower down the chest, laid back onto it from outside.
        const drop = (fit.drop ?? 0.07) * Math.max(0, cos) ** 1.5;
        if (hit && drop > 0.001) {
          const lowered = castToSkin(samples, {
            origin: hit.point.clone().addScaledVector(across, 0.15).addScaledVector(up, -drop),
            direction: across.clone().negate(),
            up,
            size: 0,
          });
          lowered?.normal.negate();
          hit = lowered;
        }
      }
      if (!hit) continue;
      path.push(hit.point.clone().addScaledVector(hit.normal, offset));
      normals.push(hit.normal.clone());
    }
    return path.length >= steps / 2 ? { path, normals, samples } : null;
  }

  // Wrist and finger: around the limb, between two joints.
  const [from, to] = def.slot === 'finger' ? ['ring_01_l', 'ring_02_l'] : ['lowerarm_l', 'hand_l'];
  const a = joint(from);
  const b = joint(to);
  const index = joint('index_01_l');
  const pinky = joint('pinky_01_l');
  const middle = joint('middle_01_l');
  const hand = joint('hand_l');
  if (!a || !b || !index || !pinky || !middle || !hand) return null;
  const axis = b.clone().sub(a).normalize();
  const centre = a.clone().lerp(b, fit.along ?? 0.5);
  const dorsal = new Vector3()
    .crossVectors(index.sub(pinky), middle.sub(hand))
    .addScaledVector(axis, 0);
  dorsal.addScaledVector(axis, -dorsal.dot(axis)).normalize();
  const finger = def.slot === 'finger';
  const samples = [sampleRest(skins.body.mesh, centre, finger ? 0.04 : 0.09, true)];
  /** Furthest (m) the limb's skin is from its axis. */
  const reach = finger ? 0.014 : 0.05;
  const u = dorsal.clone();
  const v = new Vector3().crossVectors(axis, u);
  const steps = finger ? 36 : 48;
  const hits: { point: Vector3; normal: Vector3; radial: Vector3 }[] = [];
  for (let s = 0; s < steps; s += 1) {
    const angle = (s / steps) * Math.PI * 2;
    const radial = u.clone().multiplyScalar(Math.cos(angle)).addScaledVector(v, Math.sin(angle));
    const hit = castToSkin(samples, { origin: centre, direction: radial, up, size: 0 });
    // Past the limb's own reach a ray has found another finger or the thigh.
    if (hit && hit.point.distanceTo(centre) < reach) {
      hits.push({ point: hit.point, normal: hit.normal, radial });
    }
  }
  if (hits.length < steps / 2) return null;
  if (fit.round !== undefined) {
    // A rigid round piece: a circle around the limb, by its typical radius
    // (a stray far hit must not blow it up).
    const distances = hits.map((hit) => hit.point.distanceTo(centre)).sort((p, q) => p - q);
    const typical = distances[Math.floor(distances.length * 0.8)]!;
    const radius = typical + offset + fit.round;
    for (const hit of hits) {
      path.push(centre.clone().addScaledVector(hit.radial, radius));
      normals.push(hit.radial.clone());
    }
  } else {
    for (const hit of hits) {
      path.push(hit.point.clone().addScaledVector(hit.normal, offset));
      normals.push(hit.normal.clone());
    }
  }
  return { path, normals, samples, dorsal };
}

/** Builds a loop item as skinned meshes on the body skeleton. */
function buildLoop(
  id: string,
  skins: JewellerySkins,
  joint: JointLookup,
  materials: JewelleryMaterials,
): Loop | null {
  const line = loopLine(id, skins, joint);
  if (!line) return null;
  const frame = bodyFrame(joint);
  const parts = loopPiece(
    id,
    line.path,
    line.normals,
    frame?.up ?? new Vector3(0, 1, 0),
    line.dorsal,
  );
  if (!parts) return null;
  const body = skins.body.mesh;
  const bodyIndex = new Map(body.skeleton.bones.map((bone, i) => [bone.name, i]));
  // Each centre-line point takes the weights of the skin under it.
  const anchors = line.path.map((point) => {
    const near = nearestVertex(line.samples, point);
    return near
      ? { ...bodyWeights(near.sample.mesh, near.vertex, body, bodyIndex), near }
      : { index: [0, 0, 0, 0], weight: [1, 0, 0, 0], near: null };
  });
  const bodyVertices = anchors.flatMap((anchor) =>
    anchor.near && anchor.near.sample.mesh === body ? [anchor.near.vertex] : [],
  );
  _inverse.copy(body.matrixWorld).invert();
  const meshes = parts.map((piece) => {
    const geometry = piece.geometry;
    const position = geometry.getAttribute('position');
    const skinIndex = new Uint16Array(position.count * 4);
    const skinWeight = new Float32Array(position.count * 4);
    for (let v = 0; v < position.count; v += 1) {
      _p.fromBufferAttribute(position, v);
      let best = 0;
      let bestDistance = Infinity;
      line.path.forEach((point, i) => {
        const d = point.distanceToSquared(_p);
        if (d < bestDistance) {
          bestDistance = d;
          best = i;
        }
      });
      const anchor = anchors[best]!;
      for (let k = 0; k < 4; k += 1) {
        skinIndex[v * 4 + k] = anchor.index[k]!;
        skinWeight[v * 4 + k] = anchor.weight[k]!;
      }
    }
    geometry.applyMatrix4(_inverse);
    geometry.setAttribute('skinIndex', new BufferAttribute(skinIndex, 4));
    geometry.setAttribute('skinWeight', new BufferAttribute(skinWeight, 4));
    const mesh = new SkinnedMesh(geometry, materials.get(piece.finish, piece.color));
    mesh.name = `jewellery_${id}`;
    mesh.bind(body.skeleton, body.bindMatrix);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // The body rebinds whenever the sliders move: follow it, like the garments.
    mesh.onBeforeRender = () => {
      mesh.bindMatrix.copy(body.bindMatrix);
      mesh.bindMatrixInverse.copy(body.bindMatrixInverse);
    };
    body.parent?.add(mesh);
    return mesh;
  });
  return { meshes, bodyVertices };
}

/** Builds pinned items and remembers how to keep them on their skin. */
function buildPins(
  id: string,
  skins: JewellerySkins,
  joint: JointLookup,
  materials: JewelleryMaterials,
): Pin[] {
  const def = findAccessory(id);
  const piece = pinnedPiece(id);
  if (!def || !piece) return [];
  const parent = skins.body.mesh.parent;
  if (!parent) return [];
  return pinSpots(def.slot, id, joint).flatMap((spot) => {
    const mesh = spot.head ? skins.head : skins.body.mesh;
    if (!mesh) return [];
    let at: SkinPoint | null;
    if (spot.head) {
      at = nearestSkinPoint([sampleRest(mesh, spot.target, 0.03, false)], spot.target, spot.out);
    } else {
      const sample = sampleRest(mesh, spot.target, 0.25, true);
      const hit = castToSkin([sample], {
        origin: spot.target,
        direction: spot.out,
        up: new Vector3(0, 1, 0),
        size: 0,
      });
      at = hit ? { mesh, corners: hit.corners, weights: [1 / 3, 1 / 3, 1 / 3] } : null;
    }
    const bone = skins.body.bones.get(spot.bone);
    if (!at || !bone) return [];
    const shape = spot.mirror ? mirrored(piece) : piece;
    const object = new Group();
    object.name = `jewellery_${id}`;
    object.matrixAutoUpdate = false;
    buildParts(shape.parts, materials, object);
    parent.add(object);
    // "Up" for the piece is the character's up at rest, carried by its bone.
    bone.getWorldQuaternion(_q).invert();
    const upLocal = new Vector3(0, 1, 0).applyQuaternion(_q);
    const pin: Pin = { at, object, bone, upLocal };
    if (shape.hanging) {
      const swing = new Group();
      swing.matrixAutoUpdate = false;
      buildParts(shape.hanging.parts, materials, swing);
      parent.add(swing);
      pin.hanging = {
        object: swing,
        pivot: shape.hanging.pivot,
        length: shape.hanging.length,
        tip: new Vector3(),
        previous: new Vector3(),
        ready: false,
      };
    }
    return [pin];
  });
}

const GRAVITY = 9.81;
/** Velocity kept per 60th of a second: a hanging piece settles in about a second. */
const SWING_DAMPING = 0.9;
/** A hanging piece may swing in under its pin by at most this share of its length. */
const SWING_INWARD = 0.15;

function placePin(pin: Pin, delta: number): void {
  const { object, hanging } = pin;
  const parent = object.parent;
  if (!parent) return;
  posePoint(pin.at, _p, _n);
  _y.copy(pin.upLocal).applyQuaternion(pin.bone.getWorldQuaternion(_q));
  _x.crossVectors(_y, _n).normalize();
  _y.crossVectors(_n, _x);
  _m.makeBasis(_x, _y, _n).setPosition(_p);
  _inverse.copy(parent.matrixWorld).invert();
  object.matrix.multiplyMatrices(_inverse, _m);
  object.matrixWorldNeedsUpdate = true;
  if (!hanging) return;

  const pivot = hanging.pivot.clone().applyMatrix4(_m);
  const length = hanging.length;
  if (!hanging.ready) {
    hanging.tip.copy(pivot).addScaledVector(_y, -length);
    hanging.previous.copy(hanging.tip);
    hanging.ready = true;
  }
  const step = Math.min(delta, 1 / 30);
  const velocity = _a
    .subVectors(hanging.tip, hanging.previous)
    .multiplyScalar(SWING_DAMPING ** (step * 60));
  hanging.previous.copy(hanging.tip);
  hanging.tip.add(velocity);
  hanging.tip.y -= GRAVITY * step * step;
  // Keep its length, and keep it from swinging in through the skin.
  const reach = _b.subVectors(hanging.tip, pivot);
  if (reach.lengthSq() < 1e-12) reach.copy(_y).negate();
  reach.setLength(length);
  const inward = reach.dot(_n);
  if (inward < -SWING_INWARD * length) {
    reach.addScaledVector(_n, -SWING_INWARD * length - inward).setLength(length);
  }
  hanging.tip.copy(pivot).add(reach);
  // Its frame: up against the swing, facing out of the skin.
  const upward = _c.copy(reach).negate().normalize();
  const out = _n.addScaledVector(upward, -_n.dot(upward)).normalize();
  const side = _x.crossVectors(upward, out);
  _m.makeBasis(side, upward, out).setPosition(pivot);
  hanging.object.matrix.multiplyMatrices(_inverse, _m);
  hanging.object.matrixWorldNeedsUpdate = true;
}

/** Share of a loop's body skin a garment must cover for the loop to hide under it. */
const COVERED = 0.35;

/**
 * Puts jewellery on: measures each item on the resting skin and adds its
 * meshes next to the body. Items that find no skin are skipped.
 */
export function wearJewellery(skins: JewellerySkins, ids: readonly string[]): WornJewellery {
  const materials = new JewelleryMaterials();
  const pins: Pin[] = [];
  const loops: Loop[] = [];
  if (ids.length > 0) {
    atRest(skins.body, () => {
      const joint: JointLookup = (name) => restJoint(skins.body, name, skins.head);
      for (const id of ids) {
        const def = findAccessory(id);
        if (!def) continue;
        if (LOOP_FIT[id]) {
          const loop = buildLoop(id, skins, joint, materials);
          if (loop) loops.push(loop);
        } else {
          pins.push(...buildPins(id, skins, joint, materials));
        }
      }
    });
  }
  return {
    update: (delta) => {
      for (const pin of pins) placePin(pin, delta);
    },
    syncHidden: (body) => {
      const hidden = body.geometry.getAttribute(BODY_HIDDEN);
      for (const loop of loops) {
        const covered = hidden ? loop.bodyVertices.filter((v) => hidden.getX(v) > 0.5).length : 0;
        const shown =
          loop.bodyVertices.length === 0 || covered / loop.bodyVertices.length < COVERED;
        for (const mesh of loop.meshes) mesh.visible = shown;
      }
      for (const pin of pins) {
        if (pin.at.mesh !== body) continue;
        const shown = !hidden || pin.at.corners.every((v) => hidden.getX(v) < 0.5);
        pin.object.visible = shown;
        if (pin.hanging) pin.hanging.object.visible = shown;
      }
    },
    dispose: () => {
      const geometries = new Set<BufferGeometry>();
      for (const loop of loops) {
        for (const mesh of loop.meshes) {
          mesh.removeFromParent();
          geometries.add(mesh.geometry);
        }
      }
      for (const pin of pins) {
        for (const group of [pin.object, pin.hanging?.object]) {
          if (!group) continue;
          group.removeFromParent();
          group.traverse((node) => {
            if ((node as Mesh).isMesh) geometries.add((node as Mesh).geometry);
          });
        }
      }
      for (const geometry of geometries) geometry.dispose();
      materials.dispose();
    },
  };
}
