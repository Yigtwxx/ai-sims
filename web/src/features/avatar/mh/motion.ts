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
/** Cross-fade into gestures when speech starts (seconds): they should start with the words. */
export const TALK_FADE = 0.5;
/**
 * Speech pauses shorter than this (seconds) keep the gestures going: a reply
 * plays sentence by sentence, with short gaps between the clips.
 */
export const TALK_HOLD = 1.5;

/**
 * What the character is doing, each with its own clips: idling, gesturing
 * while it speaks, or listening (the idles plus listening clips).
 */
export type MotionRole = 'idle' | 'talk' | 'listen';

/** Clips by role. Talk and listen clips always drive the whole body. */
export type MotionSets = Partial<Record<MotionRole, readonly MotionClip[]>>;

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
 * cross-fading to another clip of the current role (never the same one twice
 * in a row) shortly before the current one would end or repeat, and at once
 * when the role changes. The procedural life layer is applied on top of
 * whatever the mixer wrote this frame.
 *
 * Fades are linear ramps from each clip's weight now, not three.js
 * `crossFadeFrom`: that restarts a fade-out at full weight, so a switch landing
 * mid-way through a cross-fade (speech starting during an idle blend) made the
 * pose pop and the weights sum past 1.
 *
 * Pelvis translation is applied relative to the body's current rest pose, so
 * the feet stay on the floor whatever the height and body sliders do.
 */
export class MotionPlayer {
  private readonly mixer: AnimationMixer;
  private readonly actions: AnimationAction[];
  private readonly roles: MotionRole[];
  /** Clip indices each role picks from. */
  private readonly pools: Record<MotionRole, number[]>;
  private readonly pelvisPaths: (PelvisPath | null)[];
  /** Per clip: its weight now, the weight it fades to and how fast (per second). */
  private readonly weights: number[];
  private readonly targets: number[];
  private readonly rates: number[];
  private current = -1;
  private nextIn = 0;
  private role: MotionRole = 'idle';
  private wanted: MotionRole = 'idle';
  /** Seconds left before a quiet spell ends the gestures. */
  private holdLeft = 0;
  private readonly offset = new Vector3();
  private readonly sample = new Vector3();

  constructor(
    private readonly root: Object3D,
    sets: MotionSets,
    private readonly pelvis: Object3D | null,
    /** The pelvis position for the current sliders (updated in place on slider changes). */
    private readonly pelvisBase: Vector3 | null,
    /** How much of the body the idle clips drive. */
    readonly layer: MocapLayer = 'full',
    private readonly random: () => number = Math.random,
  ) {
    this.mixer = new AnimationMixer(root);
    this.pelvisPaths = [];
    this.roles = [];
    const clips = (['idle', 'talk', 'listen'] as const).flatMap((role) =>
      (sets[role] ?? []).map((clip) => ({ ...clip, role })),
    );
    this.actions = clips.map(({ clip, pelvisRest, role }) => {
      this.roles.push(role);
      // Clone: the cached clip may be shared by other characters.
      const own = layerTracks(clip.clone(), role === 'idle' ? layer : 'full');
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
    this.weights = this.actions.map(() => 0);
    this.targets = this.actions.map(() => 0);
    this.rates = this.actions.map(() => 0);
    const indices = (role: MotionRole) =>
      this.roles.flatMap((own, index) => (own === role ? [index] : []));
    const idle = indices('idle');
    const talk = indices('talk');
    this.pools = {
      idle,
      // No gestures: keep idling while speaking.
      talk: talk.length > 0 ? talk : idle,
      listen: [...idle, ...indices('listen')],
    };
  }

  get active(): boolean {
    return this.actions.length > 0;
  }

  /** Name of the clip playing (or fading in) now. */
  get playing(): string | null {
    return this.current < 0 ? null : this.actions[this.current]!.getClip().name;
  }

  /** Weight of each clip now, by clip name (clips that are not playing are left out). */
  get blend(): Record<string, number> {
    const out: Record<string, number> = {};
    this.actions.forEach((action, i) => {
      if (this.weights[i]! > 0) out[action.getClip().name] = this.weights[i]!;
    });
    return out;
  }

  /**
   * Share of the arms and head the clips drive now (0..1): always 1 when the
   * idles play the full body; over body-layer idles it follows a talk or
   * listen clip fading in and out.
   */
  get upper(): number {
    if (this.layer === 'full') return 1;
    let weight = 0;
    this.actions.forEach((action, i) => {
      if (this.roles[i] !== 'idle' && action.isRunning()) weight += action.getEffectiveWeight();
    });
    return Math.min(1, weight);
  }

  /** The role to play from the next update: talk starts at once and outlasts short pauses. */
  setRole(role: MotionRole): void {
    this.wanted = role;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.nextIn -= dt;
    this.stepRole(dt);
    if (this.current < 0 || this.nextIn <= 0) this.switchTo(this.pickNext(), IDLE_FADE);
    this.stepFades(dt);
    this.mixer.update(dt);
    this.applyPelvis();
  }

  private stepRole(dt: number): void {
    if (this.wanted === 'talk') this.holdLeft = TALK_HOLD;
    else if (this.role === 'talk') {
      this.holdLeft -= dt;
      if (this.holdLeft > 0) return;
    }
    if (this.wanted === this.role) return;
    this.role = this.wanted;
    // A clip the new role also plays (an idle when listening starts) plays on.
    if (this.current < 0 || this.pools[this.role].includes(this.current)) return;
    this.switchTo(this.pickNext(), this.role === 'talk' ? TALK_FADE : IDLE_FADE);
  }

  /** Moves each clip's weight toward its target; a clip that has faded out stops. */
  private stepFades(dt: number): void {
    this.actions.forEach((action, i) => {
      const [weight, target] = [this.weights[i]!, this.targets[i]!];
      if (weight === target) return;
      const step = this.rates[i]! * dt;
      const now =
        target > weight ? Math.min(target, weight + step) : Math.max(target, weight - step);
      this.weights[i] = now;
      action.setEffectiveWeight(now);
      if (now === 0 && target === 0) action.stop();
    });
  }

  private applyPelvis(): void {
    if (!this.pelvis || !this.pelvisBase) return;
    this.offset.set(0, 0, 0);
    let total = 0;
    this.actions.forEach((action, i) => {
      const path = this.pelvisPaths[i];
      const weight = action.isRunning() ? action.getEffectiveWeight() : 0;
      if (!path || weight <= 0) return;
      const values = path.interpolant.evaluate(action.time);
      this.sample.set(values[0]!, values[1]!, values[2]!).sub(path.rest);
      this.offset.addScaledVector(this.sample, weight);
      total += weight;
    });
    // The mixer averages the bones once the weights sum past 1; so does the pelvis.
    this.offset.divideScalar(Math.max(1, total));
    this.pelvis.position.copy(this.pelvisBase).add(this.offset);
  }

  private pickNext(): number {
    const pool = this.pools[this.role];
    if (pool.length === 1) return pool[0]!;
    const at = pool.indexOf(this.current);
    if (at < 0) return pool[Math.floor(this.random() * pool.length)]!;
    const step = 1 + Math.floor(this.random() * (pool.length - 1));
    return pool[(at + step) % pool.length]!;
  }

  private switchTo(index: number, fade: number): void {
    const next = this.actions[index]!;
    const duration = next.getClip().duration;
    // A clip still fading out comes back from where it is: restarting it would pop the pose.
    if (index === this.current || this.weights[index] === 0) {
      next.reset();
      // Gesture and listening takes are long: start anywhere, so replies do not all open alike.
      if (this.roles[index] !== 'idle') {
        next.time = this.random() * Math.max(0, duration - fade - 2 * IDLE_FADE);
      }
    }
    next.play();
    if (this.current < 0) {
      // The first clip starts at full weight, without a blend from the rest pose.
      this.weights[index] = 1;
      next.setEffectiveWeight(1);
    }
    // Every clip fades from the weight it has now, also in the middle of an earlier
    // cross-fade: the weights stay continuous and their sum never grows past 1.
    this.actions.forEach((_, i) => {
      this.targets[i] = i === index ? 1 : 0;
      this.rates[i] = Math.abs(this.targets[i]! - this.weights[i]!) / fade;
    });
    this.current = index;
    // Leave before the clip ends: mocap takes do not loop cleanly.
    this.nextIn = Math.max(fade, duration - next.time - IDLE_FADE);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
  }
}
