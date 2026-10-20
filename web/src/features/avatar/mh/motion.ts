import {
  AnimationMixer,
  LoopRepeat,
  Vector3,
  type AnimationAction,
  type AnimationClip,
  type Interpolant,
  type KeyframeTrack,
  type Object3D,
} from 'three';

/** Cross-fade between idle clips (seconds). */
export const IDLE_FADE = 1.2;

/**
 * How much of the body the clips drive. `full`: everything. `body`: pelvis,
 * spine and legs only (the weight shift and sway); arms and head stay with the
 * procedural layer, for clips whose hands or gaze do something a conversation
 * should not show (a phone, crossed arms).
 */
export type MocapLayer = 'full' | 'body';

/** Bones a `body` layer leaves to the procedural layer. */
const UPPER_LIMBS =
  /^(clavicle|upperarm|lowerarm|hand|thumb|index|middle|ring|pinky|neck|head)[_.]/;

export function layerTracks(clip: AnimationClip, layer: MocapLayer): AnimationClip {
  if (layer === 'full') return clip;
  clip.tracks = clip.tracks.filter((track) => !UPPER_LIMBS.test(track.name));
  return clip;
}

export interface MotionClip {
  clip: AnimationClip;
  /** Pelvis position of the skeleton the clip was retargeted to (its rest pose). */
  pelvisRest: Vector3 | null;
}

interface PelvisPath {
  rest: Vector3;
  interpolant: Interpolant;
}

/**
 * Plays mocap body clips on the assembled character: one at a time, looping,
 * cross-fading to another clip (never the same one twice in a row) shortly
 * before the current one would end or repeat. The procedural life layer is
 * applied on top of whatever the mixer wrote this frame.
 *
 * Pelvis translation is applied relative to the body's current rest pose, so
 * the feet stay on the floor whatever the height and body sliders do.
 */
export class MotionPlayer {
  private readonly mixer: AnimationMixer;
  private readonly actions: AnimationAction[];
  private readonly pelvisPaths: (PelvisPath | null)[];
  private current = -1;
  private nextIn = 0;
  private readonly offset = new Vector3();
  private readonly sample = new Vector3();

  constructor(
    private readonly root: Object3D,
    clips: readonly MotionClip[],
    private readonly pelvis: Object3D | null,
    /** The pelvis position for the current sliders (updated in place on slider changes). */
    private readonly pelvisBase: Vector3 | null,
    readonly layer: MocapLayer = 'full',
    private readonly random: () => number = Math.random,
  ) {
    this.mixer = new AnimationMixer(root);
    this.pelvisPaths = [];
    this.actions = clips.map(({ clip, pelvisRest }) => {
      // Clone: the cached clip may be shared by other characters.
      const own = layerTracks(clip.clone(), layer);
      const index = own.tracks.findIndex((track) => track.name === 'pelvis.position');
      const track: KeyframeTrack | undefined = index >= 0 ? own.tracks[index] : undefined;
      if (track && pelvisRest && pelvis && pelvisBase) {
        own.tracks.splice(index, 1);
        this.pelvisPaths.push({
          rest: pelvisRest,
          interpolant: track.InterpolantFactoryMethodLinear(new Float32Array(3)),
        });
      } else {
        this.pelvisPaths.push(null);
      }
      const action = this.mixer.clipAction(own);
      action.setLoop(LoopRepeat, Infinity);
      return action;
    });
  }

  get active(): boolean {
    return this.actions.length > 0;
  }

  /** Name of the clip playing (or fading in) now. */
  get playing(): string | null {
    return this.current < 0 ? null : this.actions[this.current]!.getClip().name;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.nextIn -= dt;
    if (this.current < 0 || this.nextIn <= 0) this.switchTo(this.pickNext());
    this.mixer.update(dt);
    this.applyPelvis();
  }

  private applyPelvis(): void {
    if (!this.pelvis || !this.pelvisBase) return;
    this.offset.set(0, 0, 0);
    this.actions.forEach((action, i) => {
      const path = this.pelvisPaths[i];
      const weight = action.isRunning() ? action.getEffectiveWeight() : 0;
      if (!path || weight <= 0) return;
      const values = path.interpolant.evaluate(action.time);
      this.sample.set(values[0]!, values[1]!, values[2]!).sub(path.rest);
      this.offset.addScaledVector(this.sample, weight);
    });
    this.pelvis.position.copy(this.pelvisBase).add(this.offset);
  }

  private pickNext(): number {
    if (this.actions.length === 1) return 0;
    if (this.current < 0) return Math.floor(this.random() * this.actions.length);
    const step = 1 + Math.floor(this.random() * (this.actions.length - 1));
    return (this.current + step) % this.actions.length;
  }

  private switchTo(index: number): void {
    const next = this.actions[index]!;
    const previous = this.current >= 0 ? this.actions[this.current] : undefined;
    next.reset();
    next.play();
    if (previous && previous !== next) next.crossFadeFrom(previous, IDLE_FADE, false);
    this.current = index;
    // Leave before the clip ends: mocap idles do not loop cleanly.
    this.nextIn = Math.max(IDLE_FADE, next.getClip().duration - IDLE_FADE);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
  }
}
