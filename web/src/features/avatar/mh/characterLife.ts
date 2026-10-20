import { applyMouthToMorphs, createMouthState, stepMouth } from '@/features/lipsync/mouthDriver';
import type { SpeechPlayer } from '@/features/lipsync/speechPlayer';

import { stepBlink, type BlinkState } from '../life';
import {
  createGaze,
  eyeLookMorphs,
  idlePose,
  stepGaze,
  type BoneRotation,
  type GazeState,
  type LifeMode,
} from './idle';
import type { MhCharacterHandle } from './MhCharacter';
import { applyPose, createPoseRig, type PoseRig } from './pose';

const EYES = ['FACIAL_L_Eye', 'FACIAL_R_Eye'] as const;
/** Share of a head turn the eyes cancel, so the gaze stays on the viewer. */
const EYE_COUNTER = 0.8;

export interface LifeInput {
  mode: LifeMode;
  speech?: SpeechPlayer | null;
}

/**
 * Everything that keeps one character alive frame to frame: idle body layer,
 * gaze with saccades, blinks and lip-sync. One instance per mounted character.
 */
export class CharacterLife {
  private t = 0;
  private blink: BlinkState = { nextIn: 1.2, phase: -1 };
  private gaze: GazeState = createGaze();
  private mouth = createMouthState();
  private rig: PoseRig | undefined;
  private rigFor: MhCharacterHandle | undefined;

  constructor(private readonly random: () => number = Math.random) {}

  step(handle: MhCharacterHandle, dt: number, { mode, speech }: LifeInput): void {
    const delta = Math.min(dt, 0.1);
    this.t += delta;
    if (this.rigFor !== handle) {
      // First frame of this character: its bones are at rest right now.
      const bones = new Set([...idlePose({ t: 0, mode: 'idle' }).map((r) => r.bone), ...EYES]);
      this.rig = createPoseRig(handle.body.root, bones);
      this.rigFor = handle;
    }

    const speaking = speech?.isPlaying ?? false;
    const lifeMode: LifeMode = speaking ? 'speaking' : mode;
    const loudness = speaking ? speech!.loudness() : 0;

    const rotations = idlePose({ t: this.t, mode: lifeMode, loudness });
    this.gaze = stepGaze(this.gaze, delta, lifeMode, this.random);
    const head = headTurn(rotations);
    const eyeYaw = this.gaze.yaw - head.yaw * EYE_COUNTER;
    const eyePitch = this.gaze.pitch + head.pitch * EYE_COUNTER;
    for (const eye of EYES) {
      rotations.push({ bone: eye, axis: [0, 1, 0], angle: eyeYaw });
      rotations.push({ bone: eye, axis: [1, 0, 0], angle: -eyePitch });
    }
    applyPose(this.rig!, rotations);

    for (const [name, weight] of Object.entries(eyeLookMorphs(eyeYaw, eyePitch))) {
      handle.setFaceMorph(name, weight);
    }
    const blink = stepBlink(this.blink, delta, this.random);
    this.blink = blink.state;
    // Looking down lowers the lids a little even between blinks.
    const lid = Math.max(blink.weight, Math.max(0, -eyePitch) * 1.2);
    handle.setFaceMorph('eyeBlinkLeft', lid);
    handle.setFaceMorph('eyeBlinkRight', lid);

    stepMouth(this.mouth, speaking ? speech!.sample() : {}, delta);
    applyMouthToMorphs(handle.faceMeshes, this.mouth);
  }
}

/** Total yaw (about Y) and pitch (about X, + looks down) of the head chain. */
function headTurn(rotations: readonly BoneRotation[]): { yaw: number; pitch: number } {
  let yaw = 0;
  let pitch = 0;
  for (const { bone, axis, angle } of rotations) {
    if (bone !== 'pelvis' && bone !== 'neck_01' && bone !== 'head') continue;
    if (axis[1] === 1) yaw += angle;
    if (axis[0] === 1 && bone !== 'pelvis') pitch += angle;
  }
  return { yaw, pitch };
}
