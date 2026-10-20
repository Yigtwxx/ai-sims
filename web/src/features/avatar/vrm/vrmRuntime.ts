import { VRMUtils, type VRM, type VRMHumanBoneName } from '@pixiv/three-vrm';
import { MathUtils, Object3D, Vector3, type Mesh } from 'three';

import type { SpeechPlayer } from '../../lipsync/speechPlayer';
import { emptyVrmMouth, toVrmMouth, type VrmMouthWeights } from '../../lipsync/visemes';
import { stepBlink, type BlinkState } from '../life';
import { applyPose, idleOffsets } from './pose';

const VOWELS = ['aa', 'ih', 'ou', 'ee', 'oh'] as const;
// VRoid faces expose a raw lip-closure morph; VRM presets have no "closed" vowel.
const LIP_CLOSE_MORPH = 'Fcl_MTH_Close';

/** Per-character animation state for the base (face-owning) VRM. */
export interface BaseRuntime {
  vrm: VRM;
  closeTargets: { mesh: Mesh; index: number }[];
  lookTarget: Object3D;
  mouth: VrmMouthWeights;
  blink: BlinkState;
  saccade: { x: number; y: number; nextIn: number };
}

/** Normalize orientation and render flags shared by base and part VRMs. */
export function prepareVrm(vrm: VRM): void {
  // VRM 0.x models face -Z; normalize so every model faces the camera (+Z).
  VRMUtils.rotateVRM0(vrm);
  vrm.scene.traverse((obj) => {
    obj.frustumCulled = false;
    const mesh = obj as Mesh;
    if (mesh.isMesh) mesh.castShadow = true;
  });
}

export function isVrm0(vrm: VRM): boolean {
  return vrm.meta?.metaVersion === '0';
}

function normalizedBone(vrm: VRM, name: VRMHumanBoneName) {
  return vrm.humanoid?.getNormalizedBoneNode(name) ?? undefined;
}

export function setupBase(vrm: VRM): BaseRuntime {
  prepareVrm(vrm);

  // Natural standing pose (see pose.ts). Part VRMs copy it every frame.
  applyPose(vrm, isVrm0(vrm));

  const closeTargets: BaseRuntime['closeTargets'] = [];
  vrm.scene.traverse((obj) => {
    const mesh = obj as Mesh;
    const index = mesh.morphTargetDictionary?.[LIP_CLOSE_MORPH];
    if (index !== undefined) closeTargets.push({ mesh, index });
  });

  const lookTarget = new Object3D();
  if (vrm.lookAt) vrm.lookAt.target = lookTarget;

  return {
    vrm,
    closeTargets,
    lookTarget,
    mouth: emptyVrmMouth(),
    blink: { nextIn: 1.2, phase: -1 },
    saccade: { x: 0, y: 0, nextIn: 0.6 },
  };
}

/** Standing height: head bone height plus ~12% of it for the skull above the joint. */
export function measureHeight(vrm: VRM): number {
  const head = normalizedBone(vrm, 'head');
  if (!head) return 1.6;
  vrm.scene.updateMatrixWorld(true);
  return head.getWorldPosition(new Vector3()).y * 1.12;
}

/** Per-frame expression, gaze and idle motion for the base VRM. */
export function animateBase(
  runtime: BaseRuntime,
  t: number,
  dt: number,
  camera: Object3D,
  speech: SpeechPlayer | undefined,
): void {
  const { vrm, mouth } = runtime;
  const expressions = vrm.expressionManager;

  // Lip-sync: fast attack keeps consonants crisp, softer release looks natural.
  const target = toVrmMouth(speech?.sample() ?? {});
  for (const key of [...VOWELS, 'close'] as const) {
    const lambda = target[key] > mouth[key] ? 30 : 18;
    mouth[key] = MathUtils.damp(mouth[key], target[key], lambda, dt);
  }
  // A closing mouth suppresses vowel openings so m/b/p visibly seal the lips.
  const open = 1 - mouth.close;
  for (const vowel of VOWELS) expressions?.setValue(vowel, mouth[vowel] * open);
  for (const { mesh, index } of runtime.closeTargets) {
    if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = mouth.close * 0.6;
  }

  const blink = stepBlink(runtime.blink, dt, Math.random);
  runtime.blink = blink.state;
  expressions?.setValue('blink', blink.weight);

  // Gaze: look at the viewer, with small saccades so the eyes feel alive.
  const s = runtime.saccade;
  s.nextIn -= dt;
  if (s.nextIn <= 0) {
    s.x = MathUtils.randFloatSpread(0.06);
    s.y = MathUtils.randFloatSpread(0.04);
    s.nextIn = 0.6 + Math.random() * 2.4;
  }
  runtime.lookTarget.position.copy(camera.position);
  runtime.lookTarget.position.x += s.x;
  runtime.lookTarget.position.y += s.y;

  // Layered idle (breathing, weight shift, head drift) on top of the pose.
  applyPose(vrm, isVrm0(vrm), idleOffsets(t));

  vrm.update(dt);
}
