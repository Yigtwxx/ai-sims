import {
  Matrix4,
  Quaternion,
  Vector3,
  type Material,
  type Object3D,
  type SkinnedMesh,
} from 'three';

import type { MhCharacterHandle } from '@/features/avatar/mh/MhCharacter';
import { BODY_HIDDEN } from '@/features/avatar/mh/garments';

import { tiltOf, turnToFaceViewer, type Surface, type Tilt, type Vec3 } from './sampling';

/**
 * Reads the posed character out of the stage for the silhouette sampler:
 * which meshes count, their skinned and morphed vertices in a frame where the
 * chest faces +Z, and the height above which the head and neck start.
 */

/**
 * Groom cards are stacked many layers deep (a bob's cards hold about four
 * times the area of the scalp under them): a quarter of the density, on top
 * of dropping the inner layers (keepOuterShell).
 */
const CARD_WEIGHT = 0.15;

/**
 * The surfaces a viewer sees: head and body skin (the stage renames their
 * materials `<name>_skin`), the first pass of every groom (`<slot>_core`;
 * `_fringe` draws the same cards again) and every garment
 * (`<category>_<mesh>`). Eyes, eye occlusion, tear line, lashes, teeth,
 * saliva and cartilage are left out, as is anything that is not part of the
 * character (backdrop, plinth): only skinned meshes under its root are walked.
 */
export function classify(mesh: SkinnedMesh): { kind: string; weight: number } | null {
  if (Array.isArray(mesh.material)) return null;
  const material = (mesh.material as Material).name;
  if (material === 'head' || material === 'head_skin') return { kind: 'head', weight: 1 };
  if (material === 'body' || material === 'body_skin') return { kind: 'body', weight: 1 };
  const groom = /^(hair|eyebrows|beard|mustache)_core$/.exec(mesh.name);
  if (groom) return { kind: groom[1]!, weight: CARD_WEIGHT };
  const garment = /^(top|bottom|shoes|full)_/.exec(mesh.name);
  if (garment) return { kind: garment[1]!, weight: 1 };
  return null;
}

/** The pose as sampled, to refuse a bind pose (arms held out) before it is saved. */
export interface PoseCheck {
  /** Each upper arm's angle from hanging straight down (degrees), left then right. */
  armDeg: [number, number];
  /** How far each wrist is from its hip joint, sideways (m), left then right. */
  handGap: [number, number];
}

/** Which outer-shell test a surface takes part in (see keepOuterShell). */
const SHELL_GROUP: Partial<Record<string, string>> = {
  head: 'head',
  hair: 'head',
  top: 'waist',
  bottom: 'waist',
};

/** How a figure stands: tilts from vertical and level differences, in the frame facing +Z. */
export interface Posture {
  /** Pelvis joint to the crown (the highest head-skin point): the body's axis. */
  axis: Tilt;
  /** Pelvis joint to the neck joint. */
  trunk: Tilt;
  /** Neck joint to the head joint. */
  head: Tilt;
  /** Left minus right shoulder joint height (m). */
  shoulders: number;
  /** Left minus right ankle joint height (m). */
  feet: number;
}

/**
 * How far a pose is from standing upright (degrees, lower is better): the
 * worst lean of the body's axis and the trunk in either view, with every
 * centimetre the shoulders are off level counted as a degree.
 */
export function leanOf(posture: Posture): number {
  const { axis, trunk, shoulders } = posture;
  return Math.max(
    Math.abs(axis.front),
    Math.abs(axis.side),
    Math.abs(trunk.front),
    Math.abs(trunk.side),
    Math.abs(shoulders) * 100,
  );
}

export interface Figure {
  surfaces: Surface[];
  /** Meshes walked but left out, for the report. */
  skipped: string[];
  /** The turn applied about +Y (radians) so the chest faces +Z. */
  turn: number;
  /** How it stood as posed, and after the upright turn (see `upright`). */
  posture: { posed: Posture; sampled: Posture };
  /** The rigid turn (degrees) about the feet that stood the body's axis upright; 0 when off. */
  upright: number;
  /** Height of the neck joint: the head and neck region starts here. */
  neckY: number;
  /** Roughly the skull's centre: 8.5 cm behind and 2 cm above the eyes. */
  skull: Vec3;
  /** The most forward head-skin vertex (the nose tip when the face is toward +Z). */
  nose: Vec3 | null;
  /** Where a top's hem overlaps the bottom's waistband (heights, m), when both are worn. */
  waist: { above: number; below: number } | null;
  /** The pelvis joint: the waist shell's vertical axis runs through it. */
  pelvis: Vec3;
  pose: PoseCheck;
}

const world = new Vector3();
const vertex = new Vector3();

function at(object: Object3D | undefined): Vec3 | null {
  if (!object) return null;
  object.getWorldPosition(world);
  return [world.x, world.y, world.z];
}

const apply = (matrix: Matrix4, [x, y, z]: Vec3): Vec3 => {
  const point = new Vector3(x, y, z).applyMatrix4(matrix);
  return [point.x, point.y, point.z];
};

/** True when the object and all its ancestors are visible (traverseVisible checks descendants only). */
function shown(object: Object3D): boolean {
  for (let node: Object3D | null = object; node; node = node.parent) {
    if (!node.visible) return false;
  }
  return true;
}

/** The turn about +Y that squares the chest to the viewer, checked against the eyes. */
function facingOf(handle: MhCharacterHandle): { turn: number; facing: Matrix4 } {
  const joint = (name: string) => at(handle.body.bones.get(name));
  const left = joint('clavicle_l');
  const right = joint('clavicle_r');
  const head = joint('head');
  if (!left || !right || !head) throw new Error('Skeleton joints missing');
  let turn = turnToFaceViewer(left, right);
  const facing = new Matrix4().makeRotationY(turn);
  // The eyes sit in front of the head joint: if not, the chest line read backwards.
  const [eyeL, eyeR] = ['FACIAL_L_Eye', 'FACIAL_R_Eye'].map((name) =>
    at(handle.body.root.getObjectByName(name)),
  );
  if (eyeL && eyeR) {
    const eyeZ = apply(facing, [(eyeL[0] + eyeR[0]) / 2, 0, (eyeL[2] + eyeR[2]) / 2])[2];
    if (eyeZ < apply(facing, [head[0], 0, head[2]])[2]) {
      turn += Math.PI;
      facing.makeRotationY(turn);
    }
  }
  return { turn, facing };
}

/** The highest head-skin vertex under `transform` (mesh world matrices applied first). */
function crownOf(root: Object3D, transform: Matrix4): Vec3 | null {
  let crown: Vec3 | null = null;
  const matrix = new Matrix4();
  root.traverseVisible((node) => {
    const mesh = node as SkinnedMesh;
    if (!mesh.isSkinnedMesh || classify(mesh)?.kind !== 'head') return;
    matrix.multiplyMatrices(transform, mesh.matrixWorld);
    const count = mesh.geometry.getAttribute('position').count;
    for (let v = 0; v < count; v += 1) {
      mesh.getVertexPosition(v, vertex).applyMatrix4(matrix);
      if (!crown || vertex.y > crown[1]) crown = [vertex.x, vertex.y, vertex.z];
    }
  });
  return crown;
}

function postureOf(joint: (name: string) => Vec3 | null, crown: Vec3): Posture {
  const need = (name: string) => {
    const position = joint(name);
    if (!position) throw new Error(`Joint ${name} missing`);
    return position;
  };
  const pelvis = need('pelvis');
  const neck = need('neck_01');
  return {
    axis: tiltOf(pelvis, crown),
    trunk: tiltOf(pelvis, neck),
    head: tiltOf(neck, need('head')),
    shoulders: need('upperarm_l')[1] - need('upperarm_r')[1],
    feet: need('foot_l')[1] - need('foot_r')[1],
  };
}

/**
 * How the character on stage stands now (joints and the crown only, no
 * sampling): cheap enough to scan a clip frame by frame for an upright one.
 */
export function measurePosture(handle: MhCharacterHandle): Posture {
  const root = handle.body.root;
  root.updateMatrixWorld(true);
  const { facing } = facingOf(handle);
  const crown = crownOf(root, facing);
  if (!crown) throw new Error('No head skin on stage');
  return postureOf((name) => {
    const position = at(handle.body.bones.get(name));
    return position ? apply(facing, position) : null;
  }, crown);
}

/**
 * Posed surfaces of the character on stage. Call between frames, after the
 * pose was held and drawn: world matrices are refreshed here first.
 *
 * Upright: the whole figure can be turned (rigidly, about the middle of its
 * feet) so that the pelvis-to-crown axis stands exactly vertical in the front
 * and side views: a mocap idle shifts its weight onto one hip and leans,
 * which a still silhouette reads as falling over. `auto` turns it only when
 * the axis leans more than `slack` degrees: an upright frame of the clip is
 * the better fix (the turn also tips the trunk the other way).
 */
export function collectFigure(
  handle: MhCharacterHandle,
  { upright = 'auto', slack = 3 }: { upright?: 'auto' | 'always' | 'never'; slack?: number } = {},
): Figure {
  const root = handle.body.root;
  root.updateMatrixWorld(true);
  if (!shown(root)) throw new Error('The character is not on screen yet');

  const joint = (name: string) => at(handle.body.bones.get(name));
  const neckWorld = joint('neck_01');
  const headWorld = joint('head');
  const hips = joint('pelvis');
  const eyes = ['FACIAL_L_Eye', 'FACIAL_R_Eye'].map((name) => at(root.getObjectByName(name)));
  const feet = ['foot_l', 'foot_r', 'ball_l', 'ball_r'].map(joint);
  if (!neckWorld || !headWorld || !hips || feet.some((foot) => !foot)) {
    throw new Error('Skeleton joints missing');
  }

  const { turn, facing } = facingOf(handle);
  const crown = crownOf(root, facing);
  if (!crown) throw new Error('No head skin on stage');
  const facedJoint = (name: string) => {
    const position = joint(name);
    return position ? apply(facing, position) : null;
  };
  const posed = postureOf(facedJoint, crown);

  // The rigid turn that stands the pelvis-to-crown axis up, about the feet.
  const transform = facing.clone();
  let uprightDeg = 0;
  const leaning = Math.max(Math.abs(posed.axis.front), Math.abs(posed.axis.side)) > slack;
  if (upright === 'always' || (upright === 'auto' && leaning)) {
    const pelvis = apply(facing, hips);
    const axis = new Vector3(crown[0] - pelvis[0], crown[1] - pelvis[1], crown[2] - pelvis[2]);
    const turnUp = new Quaternion().setFromUnitVectors(axis.normalize(), new Vector3(0, 1, 0));
    uprightDeg = (2 * Math.acos(Math.min(1, Math.abs(turnUp.w))) * 180) / Math.PI;
    const pivot = feet
      .map((foot) => apply(facing, foot!))
      .reduce((sum, foot) => sum.add(new Vector3(...foot)), new Vector3())
      .divideScalar(feet.length);
    transform
      .premultiply(new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z))
      .premultiply(new Matrix4().makeRotationFromQuaternion(turnUp))
      .premultiply(new Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z));
  }
  const placed = (point: Vec3): Vec3 => apply(transform, point);
  const placedJoint = (name: string) => {
    const position = joint(name);
    return position ? placed(position) : null;
  };
  const sampled = postureOf(placedJoint, apply(transform, apply(facing.clone().invert(), crown)));

  // Behind and above the eyes; without eye joints, 10 cm over the head joint.
  const [eyeL, eyeR] = eyes;
  const [sx, sy, sz] =
    eyeL && eyeR
      ? placed([(eyeL[0] + eyeR[0]) / 2, (eyeL[1] + eyeR[1]) / 2, (eyeL[2] + eyeR[2]) / 2])
      : placed(headWorld);
  const skull: Vec3 = eyeL && eyeR ? [sx, sy + 0.02, sz - 0.085] : [sx, sy + 0.1, sz];
  const pose = poseCheck(placedJoint);

  const surfaces: Surface[] = [];
  const skipped: string[] = [];
  let nose: Vec3 | null = null;
  // Lowest point of the top, highest of the bottom: the band where they overlap.
  let hem = Infinity;
  let waistband = -Infinity;
  const meshTransform = new Matrix4();
  root.traverseVisible((node) => {
    const mesh = node as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const role = classify(mesh);
    const label = `${mesh.name || 'mesh'} (${(mesh.material as Material).name ?? '?'})`;
    if (!role || (mesh.material as Material).visible === false) {
      skipped.push(label);
      return;
    }
    const geometry = mesh.geometry;
    const count = geometry.getAttribute('position').count;
    const positions = new Float32Array(count * 3);
    meshTransform.multiplyMatrices(transform, mesh.matrixWorld);
    for (let v = 0; v < count; v += 1) {
      // Morphs and skinning into the current pose (mesh space), then into the world.
      mesh.getVertexPosition(v, vertex).applyMatrix4(meshTransform);
      positions[v * 3] = vertex.x;
      positions[v * 3 + 1] = vertex.y;
      positions[v * 3 + 2] = vertex.z;
      if (role.kind === 'top') hem = Math.min(hem, vertex.y);
      if (role.kind === 'bottom') waistband = Math.max(waistband, vertex.y);
      if (role.kind === 'head' && (!nose || vertex.z > nose[2])) {
        nose = [vertex.x, vertex.y, vertex.z];
      }
    }
    const index = geometry.getIndex();
    const indices = index
      ? Uint32Array.from(index.array as ArrayLike<number>)
      : Uint32Array.from({ length: count }, (_, i) => i);
    const hideAttribute = role.kind === 'body' ? geometry.getAttribute(BODY_HIDDEN) : undefined;
    const hidden = hideAttribute
      ? Float32Array.from({ length: count }, (_, i) => hideAttribute.getX(i))
      : null;
    surfaces.push({
      name: `${role.kind}:${label}`,
      positions,
      indices,
      hidden,
      weight: role.weight,
      shell: SHELL_GROUP[role.kind],
    });
  });

  const waist = hem < waistband ? { above: hem - 0.01, below: waistband + 0.01 } : null;
  return {
    surfaces,
    skipped,
    turn,
    posture: { posed, sampled },
    upright: uprightDeg,
    neckY: placed(neckWorld)[1],
    skull,
    nose,
    pose,
    waist,
    pelvis: placed(hips),
  };
}

/** Arm angles and hand-to-hip gaps from the joints (in the frame facing +Z). */
function poseCheck(joint: (name: string) => Vec3 | null): PoseCheck {
  const side = (s: 'l' | 'r') => {
    const shoulder = joint(`upperarm_${s}`);
    const elbow = joint(`lowerarm_${s}`);
    const wrist = joint(`hand_${s}`);
    const hip = joint(`thigh_${s}`);
    if (!shoulder || !elbow || !wrist || !hip) throw new Error('Arm or hip joints missing');
    const arm = new Vector3(elbow[0] - shoulder[0], elbow[1] - shoulder[1], elbow[2] - shoulder[2]);
    const deg = (Math.acos(-arm.normalize().y) * 180) / Math.PI;
    return [deg, Math.abs(wrist[0] - hip[0])] as const;
  };
  const [l, r] = [side('l'), side('r')];
  return { armDeg: [l[0], r[0]], handGap: [l[1], r[1]] };
}
