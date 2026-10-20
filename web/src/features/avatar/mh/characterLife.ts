import {
  applyMouthToMorphs,
  createMouthState,
  prioritizeClosures,
  stepMouth,
} from '@/features/lipsync/mouthDriver';
import type { SpeechPlayer } from '@/features/lipsync/speechPlayer';

import { Quaternion, Vector3, type Object3D } from 'three';

import { stepBlink, type BlinkState } from '../life';
import {
  createGaze,
  eyeLookMorphs,
  idlePose,
  stepGaze,
  type GazeState,
  type LifeMode,
} from './idle';
import type { MhCharacterHandle } from './MhCharacter';
import { addRotations, createPoseRig, resetPose, type PoseRig } from './pose';

const EYES = ['FACIAL_L_Eye', 'FACIAL_R_Eye'] as const;
const DEG = Math.PI / 180;
/** How far the eyes rotate in the head (radians); real eyes rarely go past ~25°. */
const EYE_LIMIT = { yaw: 25 * DEG, pitch: 18 * DEG };
/** Viewer further off the head's axis than this: look ahead instead of straining. */
const EYE_REACH = { yaw: 40 * DEG, pitch: 30 * DEG };
/** Share of the way the head turns toward the viewer, by mode (the eyes cover the rest). */
const HEAD_FOLLOW: Record<LifeMode, number> = {
  idle: 0.3,
  listening: 0.6,
  speaking: 0.6,
  thinking: 0.2,
};
const HEAD_LIMIT = { yaw: 20 * DEG, pitch: 12 * DEG };

export interface LifeInput {
  mode: LifeMode;
  speech?: SpeechPlayer | null;
  /** Camera position (world): the eyes keep contact with it. */
  viewer?: Vector3;
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

  step(handle: MhCharacterHandle, dt: number, { mode, speech, viewer }: LifeInput): void {
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

    // Rest first (for bones no clip drives), then the mocap clip, then our layers on top.
    const rig = this.rig!;
    resetPose(rig);
    const motion = handle.motion;
    motion?.update(delta);
    addRotations(
      rig,
      idlePose({
        t: this.t,
        mode: lifeMode,
        loudness,
        mocap: motion?.active ? motion.layer : null,
      }),
    );

    // The head turns part of the way toward the viewer (a clip's actor looks
    // around; in a conversation people face whom they talk to)...
    const follow = HEAD_FOLLOW[lifeMode];
    const off = aimAtViewer(handle.body.root, rig, viewer);
    const yaw = clamp(off.yaw * follow, HEAD_LIMIT.yaw);
    const pitch = clamp(off.pitch * follow, HEAD_LIMIT.pitch);
    addRotations(rig, [
      { bone: 'neck_01', axis: [0, 1, 0], angle: yaw * 0.4 },
      { bone: 'head', axis: [0, 1, 0], angle: yaw * 0.6 },
      { bone: 'neck_01', axis: [1, 0, 0], angle: -pitch * 0.4 },
      { bone: 'head', axis: [1, 0, 0], angle: -pitch * 0.6 },
    ]);

    // ...and the eyes do the rest, with the saccade offsets around the viewer.
    this.gaze = stepGaze(this.gaze, delta, lifeMode, this.random);
    const aim = aimAtViewer(handle.body.root, rig, viewer);
    const eyeYaw = clamp(aim.yaw + this.gaze.yaw, EYE_LIMIT.yaw);
    const eyePitch = clamp(aim.pitch + this.gaze.pitch, EYE_LIMIT.pitch);
    addRotations(
      rig,
      EYES.flatMap((eye) => [
        { bone: eye, axis: [0, 1, 0] as const, angle: eyeYaw },
        { bone: eye, axis: [1, 0, 0] as const, angle: -eyePitch },
      ]),
    );

    for (const [name, weight] of Object.entries(eyeLookMorphs(eyeYaw, eyePitch))) {
      handle.setFaceMorph(name, weight);
    }
    const blink = stepBlink(this.blink, delta, this.random);
    this.blink = blink.state;
    // Looking down lowers the lids a little even between blinks.
    const lid = Math.max(blink.weight, Math.max(0, -eyePitch) * 1.2);
    handle.setFaceMorph('eyeBlinkLeft', lid);
    handle.setFaceMorph('eyeBlinkRight', lid);

    stepMouth(this.mouth, speaking ? prioritizeClosures(speech!.sample()) : {}, delta);
    applyMouthToMorphs(handle.faceMeshes, this.mouth);
    // Loud open vowels drop the jaw a little further than the viseme shape alone.
    const open = this.mouth.aa + 0.6 * this.mouth.O + 0.4 * this.mouth.E + 0.2 * this.mouth.I;
    handle.setFaceMorph('jawOpen', Math.min(0.35, open * loudness * 0.35));
  }
}

const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

/**
 * Direction to the viewer in the head's rest frame: yaw (+ to the character's
 * left) and pitch (+ up), radians. `headTurn` is the head's rotation away from
 * its rest orientation and `toViewer` the eyes-to-viewer vector, both in
 * character space.
 */
export function viewerAngles(
  headTurn: Quaternion,
  toViewer: Vector3,
): { yaw: number; pitch: number } {
  const d = toViewer.clone().applyQuaternion(headTurn.clone().invert());
  return { yaw: Math.atan2(d.x, d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) };
}

const rootInverse = new Quaternion();
const headNow = new Quaternion();
const eyeCentre = new Vector3();
const eyePosition = new Vector3();
const toViewer = new Vector3();

/**
 * Eye angles that meet the viewer, relative to the head. Past EYE_REACH (the
 * viewer behind the turntable, say) the eyes settle forward rather than strain.
 */
function aimAtViewer(root: Object3D, rig: PoseRig, viewer: Vector3 | undefined) {
  const head = rig.bones.get('head');
  if (!head || !viewer) return { yaw: 0, pitch: 0 };
  root.getWorldQuaternion(rootInverse).invert();
  // Head rotation since rest, in character space: (root⁻¹ · head) · rest⁻¹.
  const turn = headNow
    .copy(rootInverse)
    .multiply(head.getWorldQuaternion(headNow.clone()))
    .multiply(rig.parentRest.get('head')!.clone().multiply(rig.rest.get('head')!).invert());
  eyeCentre.set(0, 0, 0);
  let eyes = 0;
  for (const name of EYES) {
    const eye = rig.bones.get(name);
    if (!eye) continue;
    eyeCentre.add(eye.getWorldPosition(eyePosition));
    eyes += 1;
  }
  if (eyes === 0) return { yaw: 0, pitch: 0 };
  eyeCentre.divideScalar(eyes);
  toViewer.copy(viewer).sub(eyeCentre).applyQuaternion(rootInverse);
  const aim = viewerAngles(turn, toViewer);
  if (Math.abs(aim.yaw) > EYE_REACH.yaw || Math.abs(aim.pitch) > EYE_REACH.pitch) {
    return { yaw: 0, pitch: 0 };
  }
  return aim;
}
