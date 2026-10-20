'use client';

import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { MathUtils, Object3D, Vector3, type Mesh } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import type { SpeechPlayer } from '../lipsync/speechPlayer';
import { emptyVrmMouth, toVrmMouth, type VrmMouthWeights } from '../lipsync/visemes';
import { stepBlink, type BlinkState } from './life';

interface VrmCharacterProps {
  url: string;
  speech?: SpeechPlayer;
  /** Reports the standing height in metres once the model is loaded. */
  onMeasured?: (height: number) => void;
}

const VOWELS = ['aa', 'ih', 'ou', 'ee', 'oh'] as const;
// VRoid faces expose a raw lip-closure morph; VRM presets have no "closed" vowel.
const LIP_CLOSE_MORPH = 'Fcl_MTH_Close';

interface Runtime {
  vrm: VRM;
  closeTargets: { mesh: Mesh; index: number }[];
  lookTarget: Object3D;
  mouth: VrmMouthWeights;
  blink: BlinkState;
  saccade: { x: number; y: number; nextIn: number };
}

function setupVrm(vrm: VRM): Runtime {
  // VRM 0.x models face -Z; normalize so every model faces the camera (+Z).
  VRMUtils.rotateVRM0(vrm);
  vrm.scene.traverse((obj) => {
    obj.frustumCulled = false;
    const mesh = obj as Mesh;
    if (mesh.isMesh) mesh.castShadow = true;
  });

  // Relaxed stance from the T-pose: arms down, slight elbow bend.
  const bone = (name: Parameters<NonNullable<VRM['humanoid']>['getNormalizedBoneNode']>[0]) =>
    vrm.humanoid?.getNormalizedBoneNode(name);
  bone('leftUpperArm')?.rotation.set(0, 0, -1.2);
  bone('rightUpperArm')?.rotation.set(0, 0, 1.2);
  bone('leftLowerArm')?.rotation.set(0, -0.15, 0);
  bone('rightLowerArm')?.rotation.set(0, 0.15, 0);

  const closeTargets: Runtime['closeTargets'] = [];
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
function measureHeight(vrm: VRM): number {
  const head = vrm.humanoid?.getNormalizedBoneNode('head');
  if (!head) return 1.6;
  vrm.scene.updateMatrixWorld(true);
  return head.getWorldPosition(new Vector3()).y * 1.12;
}

/** Per-frame expression, gaze and idle motion. Mutates three.js state directly. */
function animate(
  runtime: Runtime,
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

  // Breathing and a slow head sway.
  const chest = vrm.humanoid?.getNormalizedBoneNode('chest');
  if (chest) chest.rotation.x = Math.sin(t * 1.45) * 0.015;
  const neck = vrm.humanoid?.getNormalizedBoneNode('neck');
  if (neck) {
    neck.rotation.y = Math.sin(t * 0.37) * 0.04;
    neck.rotation.x = Math.sin(t * 0.53 + 1.3) * 0.02;
  }

  vrm.update(dt);
}

export function VrmCharacter({ url, speech, onMeasured }: VrmCharacterProps) {
  const gltf = useLoader(GLTFLoader, url, (loader) => {
    loader.register((parser) => new VRMLoaderPlugin(parser));
  });
  const camera = useThree((s) => s.camera);

  // Callbacks live in refs so a new inline function never re-runs model setup.
  const onMeasuredRef = useRef(onMeasured);
  useEffect(() => {
    onMeasuredRef.current = onMeasured;
  }, [onMeasured]);

  const runtimeRef = useRef<Runtime | undefined>(undefined);
  useLayoutEffect(() => {
    const vrm = gltf.userData.vrm as VRM | undefined;
    if (!vrm) {
      console.error(`[VrmCharacter] ${url} is not a VRM file`);
      return;
    }
    runtimeRef.current = setupVrm(vrm);
    onMeasuredRef.current?.(measureHeight(vrm));
    return () => {
      runtimeRef.current = undefined;
    };
  }, [gltf, url]);

  const speechRef = useRef(speech);
  useEffect(() => {
    speechRef.current = speech;
  }, [speech]);

  useFrame(({ clock }, dt) => {
    const runtime = runtimeRef.current;
    if (runtime) animate(runtime, clock.elapsedTime, Math.min(dt, 0.1), camera, speechRef.current);
  });

  return <primitive object={gltf.scene} />;
}
