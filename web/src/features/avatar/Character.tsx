'use client';

import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  DoubleSide,
  FrontSide,
  MathUtils,
  type Material,
  type Quaternion,
  type SkinnedMesh,
  type Mesh,
  type MeshPhysicalMaterial,
  type MeshStandardMaterial,
  type Object3D,
} from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

import {
  applyMouthToMorphs,
  createMouthState,
  stepMouth,
  type MouthState,
} from '../lipsync/mouthDriver';
import type { SpeechPlayer } from '../lipsync/speechPlayer';
import { stepBlink, type BlinkState } from './life';
import { createSkinMaterial } from './materials/skin';
import { applyRelaxedPose, collectBones, collectMorphMeshes, type BoneMap } from './rig';

interface CharacterProps {
  url: string;
  /** Speech source driving the mouth; omit for a silent character. */
  speech?: SpeechPlayer;
  /** Toggle the skin SSS approximation (for A/B comparison in the spike). */
  sss?: boolean;
}

// MPFB names the skin material "<Human>.body"; GLTFLoader keeps material names as-is.
const SKIN_MATERIAL = /(^|\.)body$/i;
const CARD_HINT = /hair|brow|lash/i;
// MPFB eyeball meshes are named after their topology ("high-poly" / "low-poly").
const EYE_HINT = /high-poly|low-poly|eyeball/i;

function prepareMaterials(root: Object3D, sss: boolean): void {
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const source = mesh.material as Material;
    const name = `${mesh.name} ${source.name}`;

    if (CARD_HINT.test(name)) {
      const mat = source as MeshStandardMaterial;
      mat.side = DoubleSide;
      mat.roughness = 0.55;
      if (/brow|lash/i.test(name)) {
        // Thin, small cards: alpha blend after opaques looks softest.
        mat.transparent = true;
        mat.depthWrite = false;
        mat.alphaTest = 0.02;
      } else {
        // Hair volume: cutout keeps depth (AO, sorting) correct.
        mat.transparent = false;
        mat.alphaTest = 0.35;
      }
      mesh.castShadow = !/brow|lash/i.test(name);
      return;
    }

    if (EYE_HINT.test(name)) {
      // Solid, front-facing, glossy eyeballs. Known issue: MPFB's high-poly eye
      // texture maps wrongly after export (eyes render pink); a procedural eye
      // shader with a customizable iris colour replaces it in the creator.
      const eye = source as MeshStandardMaterial;
      eye.transparent = false;
      eye.alphaTest = 0;
      eye.side = FrontSide;
      eye.roughness = 0.12;
      mesh.castShadow = false;
      return;
    }

    // Everything else is solid: MPFB exports alpha-blended materials, which
    // break depth-based effects (AO) and sort badly. Use cutout instead.
    const solid = source as MeshStandardMaterial;
    if (solid.transparent) {
      solid.transparent = false;
      solid.depthWrite = true;
      solid.alphaTest = 0.5;
    }

    if (
      sss &&
      SKIN_MATERIAL.test(source.name) &&
      (source as MeshStandardMaterial).isMeshStandardMaterial
    ) {
      mesh.material = createSkinMaterial(source as MeshStandardMaterial);
    }
  });
}

interface Rig {
  bones: BoneMap;
  morphMeshes: SkinnedMesh[];
  rest: { spine?: Quaternion; head?: Quaternion; leftEye?: Quaternion; rightEye?: Quaternion };
}

function buildRig(model: Object3D): Rig {
  const bones = collectBones(model);
  applyRelaxedPose(bones);
  return {
    bones,
    morphMeshes: collectMorphMeshes(model),
    rest: {
      spine: bones.get('Spine2')?.quaternion.clone(),
      head: bones.get('Head')?.quaternion.clone(),
      leftEye: bones.get('LeftEye')?.quaternion.clone(),
      rightEye: bones.get('RightEye')?.quaternion.clone(),
    },
  };
}

interface LifeState {
  blink: BlinkState;
  mouth: MouthState;
  saccade: { x: number; y: number; targetX: number; targetY: number; nextIn: number };
}

function createLifeState(): LifeState {
  return {
    blink: { nextIn: 1.5, phase: -1 },
    mouth: createMouthState(),
    saccade: { x: 0, y: 0, targetX: 0, targetY: 0, nextIn: 0.8 },
  };
}

/**
 * Per-frame procedural motion. Kept outside the component because it mutates
 * three.js objects imperatively, which React's render rules don't model.
 */
function animateRig(
  rig: Rig,
  life: LifeState,
  t: number,
  step: number,
  speech: SpeechPlayer | undefined,
): void {
  // Lip-sync: smoothed viseme weights from the speech currently heard.
  stepMouth(life.mouth, speech?.sample() ?? {}, step);
  applyMouthToMorphs(rig.morphMeshes, life.mouth);

  // Blink: drive ARKit eyeBlink shape keys on every mesh that has them.
  const result = stepBlink(life.blink, step, Math.random);
  life.blink = result.state;
  for (const mesh of rig.morphMeshes) {
    const dict = mesh.morphTargetDictionary!;
    const influences = mesh.morphTargetInfluences!;
    for (const key of ['eyeBlinkLeft', 'eyeBlinkRight']) {
      const index = dict[key];
      if (index !== undefined) influences[index] = result.weight;
    }
  }

  // Breathing: tiny chest pitch, ~14 breaths per minute.
  const spine = rig.bones.get('Spine2');
  if (spine && rig.rest.spine) {
    spine.quaternion.copy(rig.rest.spine);
    spine.rotateX(Math.sin(t * 1.45) * 0.012);
  }

  // Head micro-motion so the character never looks frozen.
  const head = rig.bones.get('Head');
  if (head && rig.rest.head) {
    head.quaternion.copy(rig.rest.head);
    head.rotateY(Math.sin(t * 0.37) * 0.025);
    head.rotateX(Math.sin(t * 0.53 + 1.3) * 0.012);
  }

  // Saccades: quick small eye jumps every 0.5-3 s.
  const s = life.saccade;
  s.nextIn -= step;
  if (s.nextIn <= 0) {
    s.targetX = MathUtils.randFloatSpread(0.08);
    s.targetY = MathUtils.randFloatSpread(0.12);
    s.nextIn = 0.5 + Math.random() * 2.5;
  }
  s.x = MathUtils.damp(s.x, s.targetX, 30, step);
  s.y = MathUtils.damp(s.y, s.targetY, 30, step);
  // Offsets are applied on top of the rest orientation (bone axes are not identity).
  for (const [name, rest] of [
    ['LeftEye', rig.rest.leftEye],
    ['RightEye', rig.rest.rightEye],
  ] as const) {
    const eye = rig.bones.get(name);
    if (!eye || !rest) continue;
    eye.quaternion.copy(rest);
    eye.rotateX(s.x);
    eye.rotateY(s.y);
  }
}

export function Character({ url, sss = true, speech }: CharacterProps) {
  const { scene } = useGLTF(url);

  const model = useMemo(() => {
    const copy = cloneSkinned(scene);
    prepareMaterials(copy, sss);
    return copy;
  }, [scene, sss]);

  // Three.js objects are mutated every frame, so the rig lives in a ref
  // (not render state) and is rebuilt whenever the model changes.
  const rigRef = useRef<Rig | undefined>(undefined);
  useLayoutEffect(() => {
    rigRef.current = buildRig(model);
  }, [model]);

  useEffect(
    () => () => {
      model.traverse((obj) => {
        const mesh = obj as Mesh;
        if (mesh.isMesh && (mesh.material as MeshPhysicalMaterial).userData?.skinUniforms) {
          (mesh.material as Material).dispose();
        }
      });
    },
    [model],
  );

  const life = useRef<LifeState>(createLifeState());
  const speechRef = useRef(speech);
  useEffect(() => {
    speechRef.current = speech;
  }, [speech]);
  useFrame(({ clock }, dt) => {
    const rig = rigRef.current;
    if (rig) {
      animateRig(rig, life.current, clock.elapsedTime, Math.min(dt, 0.1), speechRef.current);
    }
  });

  return <primitive object={model} />;
}
