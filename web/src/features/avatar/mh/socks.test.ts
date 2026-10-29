import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  MeshBasicMaterial,
  Skeleton,
  SkinnedMesh,
} from 'three';
import { describe, expect, it } from 'vitest';

import { createDefaultConfig } from '@/lib/character/defaults';
import { NUDE_TIGHTS_COLOR } from '@/lib/character/schema';

import {
  ARM_HEIGHT,
  FINEST_OPACITY,
  TOE_REINFORCED,
  LEG_HEIGHT,
  LEG_JOINTS,
  SOCK_TOE_NORMAL,
  SOCK_TOE_OFFSET,
  TOE_WEIGHT,
  applySockToes,
  createSockUniforms,
  ensureLegHeights,
  isArmBone,
  isToeBone,
  legHeights,
  parseSockToes,
  setSocks,
  sockLayer,
  sockWear,
  type SockWear,
} from './socks';

const socks = (style: 'none' | 'ankle' | 'knee' | 'tights', sheer = 0.5) => ({
  ...createDefaultConfig('female').socks,
  style,
  sheer,
});

describe('isArmBone', () => {
  it.each([
    'clavicle_l',
    'upperarm_twist_01_r',
    'lowerarm_l',
    'hand_r',
    'index_metacarpal_l',
    'ring_01_l',
    'thumb_03_r',
  ])('counts %s as an arm bone', (name) => expect(isArmBone(name)).toBe(true));

  it.each([
    'ringtoe_02_r',
    'indextoe_01_l',
    'bigtoe_02_l',
    'thigh_l',
    'calf_knee_l',
    'pelvis',
    'spine_01',
  ])('keeps %s out of the arms', (name) => expect(isArmBone(name)).toBe(false));
});

describe('legHeights', () => {
  // Three vertices: on the shin, on the hand, and between hand and hip.
  const positions = new BufferAttribute(
    new Float32Array([0.1, 0.3, 0, 0.45, 0.95, 0.1, 0.2, 0.9, 0]),
    3,
  );
  const skinIndex = new BufferAttribute(new Uint16Array([0, 0, 0, 0, 1, 0, 0, 0, 1, 2, 0, 0]), 4);
  const skinWeight = new BufferAttribute(
    new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 0.4, 0.6, 0, 0]),
    4,
  );

  it('keeps the rest height on the legs and lifts the arms out of reach', () => {
    const heights = legHeights(positions, skinIndex, skinWeight, new Set([1]));
    expect(Array.from(heights)).toEqual([Math.fround(0.3), ARM_HEIGHT, Math.fround(0.9)]);
  });

  it('sets the attribute once on a shared body geometry', () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', positions);
    geometry.setAttribute('skinIndex', skinIndex);
    geometry.setAttribute('skinWeight', skinWeight);
    const bones = ['calf_l', 'hand_l', 'bigtoe_01_l'].map((name) =>
      Object.assign(new Bone(), { name }),
    );
    const body = new SkinnedMesh(geometry, new MeshBasicMaterial());
    body.bind(new Skeleton(bones));
    ensureLegHeights(body);
    const attribute = geometry.getAttribute(LEG_HEIGHT);
    expect(attribute.getX(1)).toBe(ARM_HEIGHT);
    expect(attribute.getX(2)).toBeCloseTo(0.9);
    // The third vertex is 60 % on the big toe.
    expect(Array.from(geometry.getAttribute(TOE_WEIGHT).array)).toEqual([0, 0, Math.fround(0.6)]);
    ensureLegHeights(body);
    expect(geometry.getAttribute(LEG_HEIGHT)).toBe(attribute);
  });
});

describe('isToeBone', () => {
  it.each(['bigtoe_01_l', 'ringtoe_02_r', 'ball_l'])('counts %s', (name) =>
    expect(isToeBone(name)).toBe(true),
  );
  it.each(['ring_01_l', 'foot_l', 'calf_l'])('leaves out %s', (name) =>
    expect(isToeBone(name)).toBe(false),
  );
});

/** A sock toes file as the pipeline writes it (sock_toes.py). */
function toesFile(indices: number[], offsets: number[], normals: number[], magic = 0x4b53484d) {
  const buffer = new ArrayBuffer(12 + indices.length * 28);
  const view = new DataView(buffer);
  view.setUint32(0, magic, true);
  view.setUint32(4, 1, true);
  view.setUint32(8, indices.length, true);
  new Uint32Array(buffer, 12, indices.length).set(indices);
  new Float32Array(buffer, 12 + indices.length * 4, indices.length * 3).set(offsets);
  new Float32Array(buffer, 12 + indices.length * 16, indices.length * 3).set(normals);
  return buffer;
}

describe('sock toes', () => {
  it('reads the pipeline file', () => {
    const toes = parseSockToes(toesFile([2], [0.001, 0.002, 0.003], [0, 0.5, 0]));
    expect(Array.from(toes.indices)).toEqual([2]);
    expect(Array.from(toes.offsets)).toEqual([0.001, 0.002, 0.003].map(Math.fround));
    expect(Array.from(toes.normals)).toEqual([0, 0.5, 0]);
  });

  it('refuses other files and truncated ones', () => {
    expect(() => parseSockToes(toesFile([], [], [], 0x46546c67))).toThrow('not a sock toes file');
    expect(() => parseSockToes(toesFile([1], [0, 0, 0], [0, 0, 0]).slice(0, 30))).toThrow(
      'truncated',
    );
  });

  it('puts the offsets on the moved vertices of the body, zero elsewhere, once', () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
    const body = new SkinnedMesh(geometry, new MeshBasicMaterial());
    applySockToes(body, parseSockToes(toesFile([2], [0.001, 0, 0], [0, 0.1, 0])));
    expect(Array.from(geometry.getAttribute(SOCK_TOE_OFFSET).array)).toEqual(
      [0, 0, 0, 0, 0, 0, 0.001, 0, 0].map(Math.fround),
    );
    expect(geometry.getAttribute(SOCK_TOE_NORMAL).getY(2)).toBeCloseTo(0.1);
    const attribute = geometry.getAttribute(SOCK_TOE_OFFSET);
    applySockToes(body, parseSockToes(toesFile([0], [1, 1, 1], [0, 0, 0])));
    expect(geometry.getAttribute(SOCK_TOE_OFFSET)).toBe(attribute);
  });

  it('skips a file made for another body', () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
    const body = new SkinnedMesh(geometry, new MeshBasicMaterial());
    applySockToes(body, parseSockToes(toesFile([5], [0, 0, 0], [0, 0, 0])));
    expect(geometry.getAttribute(SOCK_TOE_OFFSET)).toBeUndefined();
  });
});

describe('sockWear', () => {
  it('wears nothing for none, and no tights on a man', () => {
    expect(sockWear(socks('none'), 'female')).toBeNull();
    expect(sockWear(socks('tights'), 'male')).toBeNull();
  });

  it('ends each length at its joint of the worn body', () => {
    expect(sockWear(socks('ankle'), 'female')!.top).toBeCloseTo(LEG_JOINTS.female.ankle + 0.05);
    expect(sockWear(socks('knee'), 'male')!.top).toBeCloseTo(LEG_JOINTS.male.knee - 0.06);
    expect(sockWear(socks('tights'), 'female')!.top).toBeCloseTo(LEG_JOINTS.female.waist + 0.03);
  });

  it('makes only tights sheer nylon, in a linear colour', () => {
    const knee = sockWear({ ...socks('knee', 0.9), color: '#ffffff' }, 'female')!;
    expect(knee).toMatchObject({ fabric: 'cotton', sheer: 0, color: [1, 1, 1] });
    const tights = sockWear({ ...socks('tights', 0.9), color: '#808080' }, 'female')!;
    expect(tights.fabric).toBe('nylon');
    expect(tights.sheer).toBe(0.9);
    // sRGB 0.5 is about 0.22 linear.
    expect(tights.color[0]).toBeCloseTo(0.216, 2);
  });

  it('takes the skin tone for nude tights only', () => {
    expect(sockWear({ ...socks('tights'), color: NUDE_TIGHTS_COLOR }, 'female')!.nude).toBe(true);
    expect(sockWear({ ...socks('tights'), color: '#141416' }, 'female')!.nude).toBe(false);
    expect(sockWear({ ...socks('knee'), color: NUDE_TIGHTS_COLOR }, 'female')!.nude).toBe(false);
  });
});

describe('sockLayer', () => {
  const knee = sockWear(socks('knee'), 'female')!;
  const tights = sockWear(socks('tights', 1), 'female')!;

  it('covers the leg under the top edge only', () => {
    expect(sockLayer(knee.top - 0.1, knee).cover).toBe(1);
    expect(sockLayer(knee.top + 0.1, knee).cover).toBe(0);
    expect(sockLayer(knee.top, knee).cover).toBeCloseTo(0.5);
    expect(sockLayer(ARM_HEIGHT, tights).cloth).toBe(0);
    expect(sockLayer(0, null)).toEqual({ cover: 0, band: 0, cloth: 0 });
  });

  it('puts the cuff just under the top edge', () => {
    expect(sockLayer(knee.top - knee.cuff / 2, knee).band).toBe(1);
    expect(sockLayer(knee.top - knee.cuff * 2, knee).band).toBe(0);
  });

  it('hides all the skin under cotton, from any angle', () => {
    expect(sockLayer(0.2, knee, 1).cloth).toBe(1);
    expect(sockLayer(0.2, knee, 0.1).cloth).toBe(1);
  });

  it('lets skin through sheer nylon seen straight on, less at grazing angles', () => {
    const facing = sockLayer(0.3, tights, 1).cloth;
    expect(facing).toBeCloseTo(FINEST_OPACITY);
    expect(sockLayer(0.3, tights, 0.3).cloth).toBeGreaterThan(facing);
    expect(sockLayer(0.3, { ...tights, sheer: 0 }, 1).cloth).toBe(1);
    // Halfway along the slider the tights still hide most of the skin.
    expect(sockLayer(0.3, { ...tights, sheer: 0.5 }, 1).cloth).toBeCloseTo(0.72, 2);
    // The waistband is a double layer: opaque.
    expect(sockLayer(tights.top - tights.cuff / 2, tights, 1).cloth).toBe(1);
    // So, near enough, is the reinforced toe.
    expect(sockLayer(0.02, tights, 1, { toeWeight: 1 }).cloth).toBeCloseTo(TOE_REINFORCED);
  });
});

describe('setSocks', () => {
  it('sets the body skin uniforms and takes the socks off again', () => {
    const material = new MeshBasicMaterial();
    const uniforms = createSockUniforms();
    material.userData.sockUniforms = uniforms;
    const wear: SockWear = {
      top: 0.4,
      cuff: 0.03,
      color: [0.5, 0.25, 0],
      sheer: 0.6,
      fabric: 'nylon',
      nude: true,
    };
    setSocks([material, new MeshBasicMaterial()], wear);
    expect(uniforms.skinSockTop.value).toBe(0.4);
    expect(uniforms.skinSockColor.value.toArray()).toEqual([0.5, 0.25, 0]);
    expect(uniforms.skinSockSheer.value).toBe(0.6);
    expect(uniforms.skinSockNylon.value).toBe(1);
    expect(uniforms.skinSockNude.value).toBe(1);
    expect(uniforms.skinSockToes.value).toBe(1);
    setSocks([material], null);
    expect(uniforms.skinSockTop.value).toBe(-1);
    expect(uniforms.skinSockNylon.value).toBe(0);
    expect(uniforms.skinSockNude.value).toBe(0);
    expect(uniforms.skinSockToes.value).toBe(0);
  });
});
