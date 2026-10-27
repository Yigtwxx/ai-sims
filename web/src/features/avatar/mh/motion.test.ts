import {
  AnimationClip,
  Bone,
  Group,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
} from 'three';
import { describe, expect, it } from 'vitest';

import { IDLE_FADE, layerTracks, MotionPlayer, TALK_FADE, TALK_HOLD } from './motion';

const QUAT = [0, 0, 0, 1, 0, 0, 0, 1];

function clip(name: string, duration: number, pelvisY: [number, number]): AnimationClip {
  return new AnimationClip(name, duration, [
    new VectorKeyframeTrack('pelvis.position', [0, duration], [0, pelvisY[0], 0, 0, pelvisY[1], 0]),
    new QuaternionKeyframeTrack('spine_01.quaternion', [0, duration], QUAT),
    new QuaternionKeyframeTrack('upperarm_l.quaternion', [0, duration], QUAT),
    new QuaternionKeyframeTrack('head.quaternion', [0, duration], QUAT),
  ]);
}

function rig() {
  const root = new Group();
  const pelvis = new Bone();
  pelvis.name = 'pelvis';
  for (const name of ['spine_01', 'upperarm_l', 'head']) {
    const bone = new Bone();
    bone.name = name;
    pelvis.add(bone);
  }
  root.add(pelvis);
  return { root, pelvis };
}

describe('layerTracks', () => {
  it('keeps every track for the full layer', () => {
    expect(layerTracks(clip('a', 2, [1, 1]), 'full').tracks).toHaveLength(4);
  });

  it('leaves arms and head out of the body layer', () => {
    const names = layerTracks(clip('a', 2, [1, 1]), 'body').tracks.map((t) => t.name);
    expect(names).toEqual(['pelvis.position', 'spine_01.quaternion']);
  });
});

describe('MotionPlayer', () => {
  it('moves the pelvis relative to the slider rest, not to the clip skeleton', () => {
    const { root, pelvis } = rig();
    const base = new Vector3(0, 0.9, 0);
    const player = new MotionPlayer(
      root,
      { idle: [{ clip: clip('a', 2, [1.0, 1.1]), pelvisRest: new Vector3(0, 1, 0) }] },
      pelvis,
      base,
    );
    player.update(1);
    // Halfway through: the clip's pelvis is 0.05 above its rest.
    expect(pelvis.position.y).toBeCloseTo(0.95, 5);
  });

  it('never picks the same clip twice in a row', () => {
    const { root, pelvis } = rig();
    const clips = ['a', 'b', 'c'].map((name) => ({
      clip: clip(name, IDLE_FADE + 1, [1, 1]),
      pelvisRest: new Vector3(0, 1, 0),
    }));
    // A random source of 0 is the worst case for repeats: the first clip, then step by one.
    const player = new MotionPlayer(root, { idle: clips }, pelvis, new Vector3(), 'full', () => 0);
    const seen: (string | null)[] = [];
    for (let i = 0; i < 4; i += 1) {
      // Each clip hands over IDLE_FADE before it ends (its 1 s of own time).
      player.update(1.3);
      seen.push(player.playing);
    }
    expect(seen).toEqual(['a', 'b', 'c', 'a']);
    player.dispose();
  });

  const sets = (names: { idle: string[]; talk?: string[]; listen?: string[] }) => {
    const motion = (name: string) => ({
      clip: clip(name, 10, [1, 1]),
      pelvisRest: new Vector3(0, 1, 0),
    });
    return {
      idle: names.idle.map(motion),
      talk: names.talk?.map(motion),
      listen: names.listen?.map(motion),
    };
  };

  it('gestures at once when speech starts and outlasts short pauses', () => {
    const { root, pelvis } = rig();
    const player = new MotionPlayer(
      root,
      sets({ idle: ['a', 'b'], talk: ['t'] }),
      pelvis,
      new Vector3(),
      'body',
      () => 0,
    );
    player.update(0.1);
    expect(player.playing).toBe('a');
    player.setRole('talk');
    player.update(0.1);
    expect(player.playing).toBe('t');
    // A gap between two sentences keeps the gesture.
    player.setRole('listen');
    player.update(TALK_HOLD / 2);
    expect(player.playing).toBe('t');
    player.update(TALK_HOLD);
    expect(player.playing).not.toBe('t');
    player.dispose();
  });

  it('lets an idle play on when listening starts', () => {
    const { root, pelvis } = rig();
    const player = new MotionPlayer(
      root,
      sets({ idle: ['a', 'b'], listen: ['l'] }),
      pelvis,
      new Vector3(),
      'body',
      () => 0,
    );
    player.update(0.1);
    player.setRole('listen');
    player.update(0.1);
    expect(player.playing).toBe('a');
    player.dispose();
  });

  it('keeps idling while speaking when there are no gestures', () => {
    const { root, pelvis } = rig();
    const player = new MotionPlayer(root, sets({ idle: ['a'] }), pelvis, new Vector3(), 'body');
    player.update(0.1);
    player.setRole('talk');
    player.update(0.1);
    expect(player.playing).toBe('a');
    player.dispose();
  });

  it('hands the arms to a gesture as it fades in over body-layer idles', () => {
    const { root, pelvis } = rig();
    const player = new MotionPlayer(
      root,
      sets({ idle: ['a'], talk: ['t'] }),
      pelvis,
      new Vector3(),
      'body',
      () => 0,
    );
    player.update(0.1);
    expect(player.upper).toBe(0);
    player.setRole('talk');
    player.update(TALK_FADE / 2);
    expect(player.upper).toBeGreaterThan(0.2);
    expect(player.upper).toBeLessThan(0.8);
    player.update(TALK_FADE);
    expect(player.upper).toBeCloseTo(1, 5);
    player.dispose();
  });

  describe('a switch in the middle of a cross-fade', () => {
    const FRAME = 1 / 60;
    // Every clip lifts the pelvis by the same 0.1, so any blend of them must too.
    const lifted = (name: string) => ({
      clip: clip(name, 10, [1.1, 1.1]),
      pelvisRest: new Vector3(0, 1, 0),
    });

    /** Plays frame by frame until `done`, returning each frame's weights and pelvis height. */
    function record(player: MotionPlayer, pelvis: Bone, seconds: number) {
      const frames: { blend: Record<string, number>; y: number }[] = [];
      for (let i = 0; i < Math.round(seconds / FRAME); i += 1) {
        player.update(FRAME);
        frames.push({ blend: player.blend, y: pelvis.position.y });
      }
      return frames;
    }

    /** No weight moves faster than a `fade`-long ramp, and the weights keep summing to 1. */
    function expectSmooth(frames: ReturnType<typeof record>, fade: number) {
      frames.forEach(({ blend, y }, k) => {
        const total = Object.values(blend).reduce((sum, w) => sum + w, 0);
        expect(total).toBeCloseTo(1, 6);
        expect(y).toBeCloseTo(0.1, 6);
        if (k === 0) return;
        const before = frames[k - 1]!.blend;
        for (const name of new Set([...Object.keys(blend), ...Object.keys(before)])) {
          const jump = Math.abs((blend[name] ?? 0) - (before[name] ?? 0));
          expect(jump).toBeLessThanOrEqual(FRAME / fade + 1e-9);
        }
      });
    }

    /** Plays until `name` starts fading in, then `seconds` into that cross-fade. */
    function into(player: MotionPlayer, name: string, seconds: number) {
      while (player.playing !== name) player.update(FRAME);
      record(player, new Bone(), seconds - FRAME);
    }

    it('keeps the weights continuous when speech starts during an idle blend', () => {
      const { root, pelvis } = rig();
      const player = new MotionPlayer(
        root,
        { idle: [lifted('a'), lifted('b')], talk: [lifted('t')] },
        pelvis,
        new Vector3(),
        'full',
        () => 0,
      );
      into(player, 'b', 0.4);
      expect(player.blend.b).toBeCloseTo(0.4 / IDLE_FADE, 1);
      const frames = record(player, pelvis, FRAME);
      player.setRole('talk');
      frames.push(...record(player, pelvis, IDLE_FADE));
      expect(player.playing).toBe('t');
      expect(player.blend).toEqual({ t: 1 });
      expectSmooth(frames, TALK_FADE);
      player.dispose();
    });

    it('brings back a clip that is still fading out from where it is', () => {
      const { root, pelvis } = rig();
      const player = new MotionPlayer(
        root,
        { idle: [lifted('a')], listen: [lifted('l')] },
        pelvis,
        new Vector3(),
        'full',
        () => 0,
      );
      player.setRole('listen');
      into(player, 'l', 0.4);
      const frames = record(player, pelvis, FRAME);
      player.setRole('idle');
      frames.push(...record(player, pelvis, 2 * IDLE_FADE));
      expect(Object.keys(player.blend)).toEqual(['a']);
      expect(player.blend.a).toBeCloseTo(1, 6);
      expectSmooth(frames, IDLE_FADE);
      player.dispose();
    });
  });

  it('drives the arms with full-layer idles', () => {
    const { root, pelvis } = rig();
    const player = new MotionPlayer(root, sets({ idle: ['a'] }), pelvis, new Vector3(), 'full');
    expect(player.upper).toBe(1);
  });

  it('holds a still at one clip time once a clip plays', () => {
    const { root, pelvis } = rig();
    const player = new MotionPlayer(
      root,
      { idle: [{ clip: clip('a', 2, [1.0, 1.2]), pelvisRest: new Vector3(0, 1, 0) }] },
      pelvis,
      new Vector3(),
    );
    expect(player.hold(0.5)).toBe(false);
    expect(player.duration).toBe(0);
    player.update(0);
    expect(player.duration).toBe(2);
    // Wrapped to the clip length: 2.5 s is 0.5 s in, a quarter of the way.
    expect(player.hold(2.5)).toBe(true);
    for (let i = 0; i < 3; i += 1) player.update(0);
    expect(pelvis.position.y).toBeCloseTo(0.05, 5);
    player.dispose();
  });

  it('poses a still every update, also after the bones were reset to rest', () => {
    const { root, pelvis } = rig();
    const arm = root.getObjectByName('upperarm_l')!;
    const turned = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.5);
    const lowered = new AnimationClip('a', 2, [
      new QuaternionKeyframeTrack(
        'upperarm_l.quaternion',
        [0, 2],
        [...turned.toArray(), ...turned.toArray()],
      ),
    ]);
    const player = new MotionPlayer(
      root,
      { idle: [{ clip: lowered, pelvisRest: null }] },
      pelvis,
      null,
    );
    for (let frame = 0; frame < 3; frame += 1) {
      // The life layer sets the bones back to rest before every update.
      arm.quaternion.identity();
      player.update(0);
      expect(arm.quaternion.angleTo(turned)).toBeCloseTo(0, 5);
    }
    player.dispose();
  });
});
