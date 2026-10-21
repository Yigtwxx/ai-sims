import { _roots, type RootState } from '@react-three/fiber';
import {
  Vector3,
  type Material,
  type Object3D,
  type PerspectiveCamera,
  type SkinnedMesh,
} from 'three';

import type { ThumbTarget } from '@/components/dev/thumbTargets';

import type { CameraPose, Landmarks, Vec3 } from './framing';

/**
 * Dev-bench probes into the stage's three.js scene (through the R3F root of
 * its canvas). The bench owns the camera of its own stage: it measures the
 * figure and aims the camera itself (see framing.ts).
 */

const stateOf = (canvas: HTMLCanvasElement): RootState | undefined =>
  _roots.get(canvas)?.store.getState();

/**
 * Is the item really drawn yet? The character stays hidden until its skin
 * textures are bound, a carded groom is added as `<slot>_core` once it is
 * loaded and fitted, seconds after the first frame, and an outfit's garments
 * as `<category>_<mesh>` once they are bound to the body. A painted groom has
 * no mesh: it is on once the stage reports the character settled (its strands
 * are drawn by the skin in the same step that fits the grooms).
 */
export function onStage(
  canvas: HTMLCanvasElement,
  target: Pick<ThumbTarget, 'kind' | 'category' | 'painted'>,
): boolean {
  const scene = stateOf(canvas)?.scene;
  if (!scene) return false;
  const { kind } = target;
  const outfitPrefix = kind === 'outfit' ? `${target.category ?? 'full'}_` : null;
  let character = false;
  let item = kind === 'face' || target.painted === true;
  // traverseVisible skips hidden subtrees, so a character still waiting for
  // its skin contributes nothing.
  scene.traverseVisible((node) => {
    if (!(node as SkinnedMesh).isSkinnedMesh) return;
    character = true;
    if (outfitPrefix ? node.name.startsWith(outfitPrefix) : node.name === `${kind}_core`) {
      item = true;
    }
  });
  return character && item;
}

const world = new Vector3();
const vertex = new Vector3();

function boneAt(scene: Object3D, name: string): Vec3 | null {
  const bone = scene.getObjectByName(name);
  if (!bone) return null;
  bone.getWorldPosition(world);
  return [world.x, world.y, world.z];
}

const materialName = (mesh: SkinnedMesh) =>
  Array.isArray(mesh.material) ? '' : (mesh.material as Material).name;

/** Lowest and highest posed vertex height of the skinned primitives with this material. */
function verticalExtent(scene: Object3D, material: string): [number, number] | null {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  scene.traverseVisible((node) => {
    const mesh = node as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    // The stage swaps the source material for its skin material (`head_skin`).
    const name = materialName(mesh);
    if (name !== material && name !== `${material}_skin`) return;
    const count = mesh.geometry.getAttribute('position').count;
    for (let i = 0; i < count; i += 1) {
      // Morphed and skinned into the current pose, then into the world.
      mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrixWorld);
      if (vertex.y < low) low = vertex.y;
      if (vertex.y > high) high = vertex.y;
    }
  });
  return Number.isFinite(low) ? [low, high] : null;
}

/** Skeleton joints the framing reads, as `[name, left, right]` or one name. */
const BONES = {
  eyeL: 'FACIAL_L_Eye',
  eyeR: 'FACIAL_R_Eye',
  chin: 'FACIAL_C_Chin',
  pelvis: 'pelvis',
  handL: 'hand_l',
  handR: 'hand_r',
  kneeL: 'calf_l',
  kneeR: 'calf_r',
  ankleL: 'foot_l',
  ankleR: 'foot_r',
  toeL: 'ball_l',
  toeR: 'ball_r',
} as const;

type Joints = Record<keyof typeof BONES, Vec3>;

/** World positions of the framing joints, or null while the skeleton is not in the scene. */
export function measureJoints(canvas: HTMLCanvasElement): Joints | null {
  const scene = stateOf(canvas)?.scene;
  if (!scene) return null;
  const joints: Partial<Joints> = {};
  for (const [key, name] of Object.entries(BONES) as [keyof Joints, string][]) {
    const at = boneAt(scene, name);
    if (!at) return null;
    joints[key] = at;
  }
  return joints as Joints;
}

/** Largest move of any joint between two measurements (metres). */
export function jointsMoved(a: Joints, b: Joints): number {
  let most = 0;
  for (const key of Object.keys(BONES) as (keyof Joints)[]) {
    for (let i = 0; i < 3; i += 1) most = Math.max(most, Math.abs(a[key][i] - b[key][i]));
  }
  return most;
}

/**
 * The figure's landmarks in its current pose: joints from the skeleton, the
 * crown from the head skin and the soles from the body skin. Walks every skin
 * vertex, so it is measured once per pose, not every frame.
 */
export function measureLandmarks(canvas: HTMLCanvasElement, joints: Joints): Landmarks | null {
  const scene = stateOf(canvas)?.scene;
  if (!scene) return null;
  const head = verticalExtent(scene, 'head');
  const body = verticalExtent(scene, 'body');
  if (!head || !body) return null;
  return {
    eyes: [
      (joints.eyeL[0] + joints.eyeR[0]) / 2,
      (joints.eyeL[1] + joints.eyeR[1]) / 2,
      (joints.eyeL[2] + joints.eyeR[2]) / 2,
    ],
    chin: joints.chin,
    crown: head[1],
    pelvis: joints.pelvis,
    hands: [joints.handL, joints.handR],
    knees: [joints.kneeL, joints.kneeR],
    ankles: [joints.ankleL, joints.ankleR],
    toes: [joints.toeL, joints.toeR],
    floor: body[0],
  };
}

/** The part of the camera-controls API the bench uses. */
interface Controls {
  minDistance: number;
  maxDistance: number;
  setLookAt(...args: [number, number, number, number, number, number, boolean]): Promise<void>;
}

/** Vertical field of view of the stage camera and the canvas size, for the square crop. */
export function viewOf(
  canvas: HTMLCanvasElement,
): { fov: number; width: number; height: number } | null {
  const state = stateOf(canvas);
  const camera = state?.camera as PerspectiveCamera | undefined;
  if (!camera?.isPerspectiveCamera) return null;
  return { fov: camera.fov, width: canvas.width, height: canvas.height };
}

/**
 * Puts the stage camera at `pose` at once (no glide). The stage's distance
 * limits are for people dollying; a close-up of the brows needs less.
 */
export function aimCamera(canvas: HTMLCanvasElement, pose: CameraPose): boolean {
  const controls = stateOf(canvas)?.controls as unknown as Controls | null | undefined;
  if (!controls || typeof controls.setLookAt !== 'function') return false;
  controls.minDistance = 0.05;
  controls.maxDistance = 50;
  void controls.setLookAt(...pose.position, ...pose.target, false);
  return true;
}

/** Where the stage camera is now, to notice when something else moved it. */
export function cameraPosition(canvas: HTMLCanvasElement): Vec3 | null {
  const camera = stateOf(canvas)?.camera;
  return camera ? [camera.position.x, camera.position.y, camera.position.z] : null;
}
