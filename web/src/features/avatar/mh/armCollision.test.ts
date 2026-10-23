import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  Group,
  MeshBasicMaterial,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';

import { ArmCollider, CLEARANCE, CLOTH, RELEASE } from './armCollision';

const DEG = Math.PI / 180;
const Z = new Vector3(0, 0, 1);
/** A torso cylinder (radius TORSO about the y axis) and arms hanging beside it. */
const TORSO = 0.15;
const FOREARM = 0.03;
const SHOULDER_X = 0.2;

const BONES = [
  ['root', null, [0, 0, 0]],
  ['pelvis', 'root', [0, 0.9, 0]],
  ['spine_03', 'pelvis', [0, 0.2, 0]],
  ['clavicle_l', 'spine_03', [0.1, 0.25, 0]],
  ['upperarm_l', 'clavicle_l', [0.1, 0.05, 0]],
  ['lowerarm_l', 'upperarm_l', [0, -0.3, 0]],
  ['hand_l', 'lowerarm_l', [0, -0.25, 0]],
  ['clavicle_r', 'spine_03', [-0.1, 0.25, 0]],
  ['upperarm_r', 'clavicle_r', [-0.1, 0.05, 0]],
  ['lowerarm_r', 'upperarm_r', [0, -0.3, 0]],
  ['hand_r', 'lowerarm_r', [0, -0.25, 0]],
] as const;

interface Ring {
  bone: string;
  x: number;
  radius: number;
  from: number;
  to: number;
  /** Radial growth of a morph target (m), for the torso. */
  grow?: number;
}

/** Vertex rings of cylinders about vertical lines, 1 cm apart, skinned whole to one bone each. */
function cylinders(rings: Ring[], names: string[]): BufferGeometry {
  const position: number[] = [];
  const normal: number[] = [];
  const index: number[] = [];
  const weight: number[] = [];
  const morph: number[] = [];
  for (const { bone, x, radius, from, to, grow = 0 } of rings) {
    for (let y = from; y >= to - 1e-9; y -= 0.01) {
      for (let k = 0; k < 48; k += 1) {
        const a = (k / 48) * Math.PI * 2;
        position.push(x + radius * Math.cos(a), y, radius * Math.sin(a));
        normal.push(Math.cos(a), 0, Math.sin(a));
        index.push(names.indexOf(bone), 0, 0, 0);
        weight.push(1, 0, 0, 0);
        morph.push(grow * Math.cos(a), 0, grow * Math.sin(a));
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normal), 3));
  geometry.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(index), 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(new Float32Array(weight), 4));
  geometry.morphAttributes.position = [new BufferAttribute(new Float32Array(morph), 3)];
  geometry.morphTargetsRelative = true;
  return geometry;
}

function rig() {
  const root = new Group();
  const bones = new Map<string, Bone>();
  for (const [name, parent, offset] of BONES) {
    const bone = new Bone();
    bone.name = name;
    bone.position.fromArray(offset);
    (parent ? bones.get(parent)! : root).add(bone);
    bones.set(name, bone);
  }
  const names = BONES.map(([name]) => name as string);
  const arm = (side: 'l' | 'r') => {
    const x = side === 'l' ? SHOULDER_X : -SHOULDER_X;
    return [
      // The upper arm's first two thirds sink into the chest: soft tissue, left out.
      { bone: `upperarm_${side}`, x: x - Math.sign(x) * 0.01, radius: 0.06, from: 1.4, to: 1.2 },
      { bone: `lowerarm_${side}`, x, radius: FOREARM, from: 1.1, to: 0.86 },
      { bone: `hand_${side}`, x, radius: FOREARM, from: 0.85, to: 0.75 },
    ];
  };
  const geometry = cylinders(
    [
      { bone: 'spine_03', x: 0, radius: TORSO, from: 1.4, to: 0.7, grow: 0.03 },
      ...arm('l'),
      ...arm('r'),
    ],
    names,
  );
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
  mesh.morphTargetInfluences = [0];
  root.add(mesh);
  root.updateMatrixWorld(true);
  const skeleton = new Skeleton(names.map((name) => bones.get(name)!));
  mesh.bind(skeleton);
  const garments: SkinnedMesh[] = [];
  return { root, mesh, garments, bones, names };
}

type Rig = ReturnType<typeof rig>;

/** A loose shell over the torso, `gap` (m) off the skin, as a garment bound to the body skeleton. */
function shirt({ mesh, names }: Rig, gap: number): SkinnedMesh {
  const garment = new SkinnedMesh(
    cylinders([{ bone: 'spine_03', x: 0, radius: TORSO + gap, from: 1.4, to: 0.7 }], names),
    new MeshBasicMaterial(),
  );
  garment.bind(mesh.skeleton, mesh.bindMatrix);
  return garment;
}

/** The left upper arm's clip pose: swung `degrees` in toward the torso. */
function swingIn({ bones }: Rig, degrees: number): void {
  bones.get('upperarm_l')!.quaternion.setFromAxisAngle(Z, -degrees * DEG);
  bones.get('upperarm_r')!.quaternion.identity();
}

/** Steps like the stage: every frame the clip poses the arm again, then the collider runs. */
function run(body: Rig, collider: ArmCollider, degrees: number, frames: number): void {
  for (let frame = 0; frame < frames; frame += 1) {
    swingIn(body, degrees);
    collider.step(1 / 60);
  }
}

/** How far the hand's inner side stands off the torso's axis (m). */
const handInside = ({ bones }: Rig) =>
  bones.get('hand_l')!.getWorldPosition(new Vector3()).x - FOREARM;

describe('ArmCollider', () => {
  it('leaves arms that hang clear of the body as the clip posed them', () => {
    const body = rig();
    const collider = new ArmCollider(body);
    run(body, collider, 0, 3);
    expect(collider.pushes).toEqual({ l: 0, r: 0 });
    expect(body.bones.get('upperarm_l')!.quaternion.equals(new Quaternion())).toBe(true);
  });

  it('ignores the upper arm sinking into the chest', () => {
    const body = rig();
    const collider = new ArmCollider(body);
    run(body, collider, 0, 1);
    // The upper arm's proximal skin lies 1 cm inside the torso at rest.
    expect(SHOULDER_X - 0.01 - 0.06).toBeLessThan(TORSO);
    expect(collider.pushes.l).toBe(0);
  });

  it('turns an arm swung into the torso just out of it', () => {
    const body = rig();
    const collider = new ArmCollider(body);
    swingIn(body, 6);
    body.root.updateMatrixWorld(true);
    // The clip puts the hand 3.8 cm inside the torso.
    expect(handInside(body)).toBeLessThan(TORSO - 0.03);
    run(body, collider, 6, 30);
    // Out to the clearance (the blended surface is a few millimetres off a coarse cylinder).
    expect(handInside(body)).toBeGreaterThan(TORSO + CLEARANCE - 0.004);
    expect(handInside(body)).toBeLessThan(TORSO + CLEARANCE + 0.01);
    // The 6° swing comes back to about 1.5°.
    expect(collider.pushes.l / DEG).toBeGreaterThan(3.5);
    expect(collider.pushes.l / DEG).toBeLessThan(5.5);
    expect(collider.pushes.r).toBe(0);
  });

  it('fades a push no longer needed back to the clip', () => {
    const body = rig();
    const collider = new ArmCollider(body);
    run(body, collider, 6, 30);
    const held = collider.pushes.l;
    run(body, collider, 0, 1);
    // One frame later it is still there, smaller: no snap.
    expect(collider.pushes.l).toBeGreaterThan(held * 0.9);
    expect(collider.pushes.l).toBeLessThan(held);
    run(body, collider, 0, 59);
    expect(collider.pushes.l).toBeLessThan(held * Math.exp(-0.9 / RELEASE));
  });

  it('keeps the clothes over the torso between them, up to CLOTH', () => {
    const body = rig();
    body.garments.push(shirt(body, 0.04));
    const collider = new ArmCollider(body);
    run(body, collider, 6, 30);
    expect(handInside(body)).toBeGreaterThan(TORSO + CLEARANCE + CLOTH - 0.004);
    expect(handInside(body)).toBeLessThan(TORSO + CLEARANCE + CLOTH + 0.01);
  });

  it('reads the clothes again when they change', () => {
    const body = rig();
    const collider = new ArmCollider(body);
    run(body, collider, 6, 30);
    const bare = collider.pushes.l;
    body.garments.push(shirt(body, 0.04));
    run(body, collider, 6, 30);
    expect(collider.pushes.l).toBeGreaterThan(bare);
  });

  it('follows the body sliders: a wider torso pushes a clear arm out', () => {
    const body = rig();
    const collider = new ArmCollider(body);
    run(body, collider, 0, 3);
    expect(collider.pushes.l).toBe(0);
    // The torso grows 3 cm, past the forearm hanging 2 cm off it.
    body.mesh.morphTargetInfluences![0] = 1;
    run(body, collider, 0, 30);
    expect(collider.pushes.l).toBeGreaterThan(0);
    expect(handInside(body)).toBeGreaterThan(TORSO + 0.03 + CLEARANCE - 0.004);
  });
});
