import {
  applyMouthToMorphs,
  createMouthState,
  prioritizeClosures,
  stepMouth,
} from '@/features/lipsync/mouthDriver';
import type { SpeechPlayer } from '@/features/lipsync/speechPlayer';

import { Quaternion, Vector3, type Object3D } from 'three';

import { stepBlink, type BlinkState } from '../life';
import { ArmCollider } from './armCollision';
import { createEmphasis, stepEmphasis, type EmphasisState } from './emphasis';
import { addFaceClip, type FaceClip } from './faceClips';
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
/** Weight of the MetaHuman face idle loop (squints, brows, dimples between blinks). */
const FACE_IDLE_WEIGHT = 0.3;
/** Mouth and jaw of the face layers while lip-sync speaks: visemes lead. */
const FACE_MOUTH_WHILE_SPEAKING = 0.25;
/** A faint, slowly breathing smile by mode (expression happy loop weight). */
const SMILE: Record<LifeMode, number> = {
  idle: 0.04,
  listening: 0.12,
  speaking: 0.08,
  thinking: 0,
};
/** Seconds for the smile to settle into a new mode. */
const SMILE_EASE = 1.5;
/** Head pitch of a full-strength stress nod (split neck 0.3, head 0.7). */
const NOD_ANGLE = 3.5 * DEG;
/** Brow raise of a full-strength stress, per morph. */
const BROW_RAISE: [string, number][] = [
  ['browInnerUp', 0.3],
  ['browOuterUpLeft', 0.22],
  ['browOuterUpRight', 0.22],
];

/** Face loops the life layer plays under blinks, gaze and lip-sync. */
export interface FaceLayers {
  idle?: FaceClip;
  smile?: FaceClip;
}

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
  private arms: ArmCollider | undefined;
  private smile = 0;
  private emphasis: EmphasisState = createEmphasis();
  private readonly face = new Map<string, number>();
  private faceDriven = new Set<string>();
  /** Set when the stage has loaded them; the character lives without them too. */
  faceLayers: FaceLayers = {};

  constructor(private readonly random: () => number = Math.random) {}

  step(handle: MhCharacterHandle, dt: number, { mode, speech, viewer }: LifeInput): void {
    const delta = Math.min(dt, 0.1);
    this.t += delta;
    if (this.rigFor !== handle) {
      // First frame of this character: its bones are at rest right now.
      const bones = new Set([...idlePose({ t: 0, mode: 'idle' }).map((r) => r.bone), ...EYES]);
      this.rig = createPoseRig(handle.body.root, bones);
      this.arms = new ArmCollider(handle.body);
      this.rigFor = handle;
    }

    const speaking = speech?.isPlaying ?? false;
    const lifeMode: LifeMode = speaking ? 'speaking' : mode;
    const loudness = speaking ? speech!.loudness() : 0;

    // Rest first (for bones no clip drives), then the mocap clip, then our layers on top.
    const rig = this.rig!;
    resetPose(rig);
    const motion = handle.motion;
    motion?.setRole(speaking ? 'talk' : lifeMode === 'listening' ? 'listen' : 'idle');
    motion?.update(delta);
    addRotations(
      rig,
      idlePose({
        t: this.t,
        mode: lifeMode,
        // A hint of the loudness only: the nods come from the stresses below.
        loudness: loudness * 0.3,
        mocap: motion?.active ? motion.layer : null,
        upper: motion?.upper,
      }),
    );
    // The arms are posed: keep them out of the body (clips copy the actor's arm
    // directions, and a MetaHuman's hips and waist are wider than an actor's).
    this.arms!.step(delta);

    // The head turns part of the way toward the viewer (a clip's actor looks
    // around; in a conversation people face whom they talk to)...
    const follow = HEAD_FOLLOW[lifeMode];
    const off = aimAtViewer(handle.body.root, rig, viewer);
    const yaw = clamp(off.yaw * follow, HEAD_LIMIT.yaw);
    const pitch = clamp(off.pitch * follow, HEAD_LIMIT.pitch);
    // Stressed syllables: a short nod (and below, often a brow raise).
    this.emphasis = stepEmphasis(this.emphasis, loudness, delta, speaking, this.random);
    const nod = this.emphasis.nod * NOD_ANGLE;
    addRotations(rig, [
      { bone: 'neck_01', axis: [0, 1, 0], angle: yaw * 0.4 },
      { bone: 'head', axis: [0, 1, 0], angle: yaw * 0.6 },
      { bone: 'neck_01', axis: [1, 0, 0], angle: -pitch * 0.4 + nod * 0.3 },
      { bone: 'head', axis: [1, 0, 0], angle: -pitch * 0.6 + nod * 0.7 },
    ]);

    // Face loops first; gaze, blinks and the jaw below write over or add to them.
    this.stepFace(handle, delta, lifeMode, speaking);

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
    const mouth = prioritizeClosures(this.mouth);
    applyMouthToMorphs(handle.faceMeshes, mouth);
    // Loud open vowels drop the jaw a little further than the viseme shape alone;
    // a closure shuts it, face loop included.
    const open = mouth.aa + 0.6 * mouth.O + 0.4 * mouth.E + 0.2 * mouth.I;
    const parted = 1 - Math.min(1, mouth.PP);
    handle.setFaceMorph(
      'jawOpen',
      (Math.min(0.35, open * loudness * 0.35) + (this.face.get('jawOpen') ?? 0)) * parted,
    );
  }

  /** Face idle plus a faint smile; channels a layer stops driving go back to rest. */
  private stepFace(
    handle: MhCharacterHandle,
    delta: number,
    mode: LifeMode,
    speaking: boolean,
  ): void {
    this.smile += (SMILE[mode] - this.smile) * Math.min(1, delta / SMILE_EASE);
    const face = this.face;
    face.clear();
    const mouth = speaking ? FACE_MOUTH_WHILE_SPEAKING : 1;
    const { idle, smile } = this.faceLayers;
    if (idle) addFaceClip(idle, this.t, FACE_IDLE_WEIGHT, face, mouth);
    // The smile breathes (comes and goes over ~30 s) rather than holding.
    const breathing = 0.6 + 0.4 * Math.sin(this.t * 0.21);
    if (smile) addFaceClip(smile, this.t, this.smile * breathing, face, mouth);
    const brow = this.emphasis.brow;
    if (brow > 0.001) {
      for (const [name, amount] of BROW_RAISE)
        face.set(name, (face.get(name) ?? 0) + brow * amount);
    }
    for (const name of this.faceDriven) if (!face.has(name)) handle.setFaceMorph(name, 0);
    for (const [name, weight] of face) handle.setFaceMorph(name, Math.min(1, weight));
    this.faceDriven = new Set(face.keys());
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
