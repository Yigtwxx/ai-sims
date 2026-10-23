import {
  Matrix4,
  Quaternion,
  Vector3,
  type Bone,
  type BufferAttribute,
  type InterleavedBufferAttribute,
  type Object3D,
  type SkinnedMesh,
} from 'three';

/**
 * Keeps the arms out of the body. The mocap clips copy the actor's bone
 * directions (web/scripts/retarget-fbx.mjs), not where the hands meet the
 * body: a MetaHuman's hips and waist are wider than the actors', so a hand
 * resting on the actor's hip sank 4-8 cm into the character's, and gestures
 * swept the forearms through the waist. After the clips and the procedural
 * layer have posed the skeleton, each upper arm turns about the shoulder just
 * far enough that the arm stays outside the torso and legs. A push no longer
 * needed fades back to the clip's pose.
 *
 * Only the body's skin collides, sampled about SPACING apart and skinned on
 * the CPU every frame as the GPU does; near an arm sample, the torso's surface
 * is a smooth blend of the planes of the torso samples around it. Clothes add
 * their thickness over the skin, up to CLOTH: loose cloth gives way (a sleeve
 * may press into a jacket's hem) rather than holding the arms out.
 */

type Attribute = BufferAttribute | InterleavedBufferAttribute;

const DEG = Math.PI / 180;
/** Bones whose skin makes up the arms, and the torso the arms must stay out of. */
const ARM = /^(upperarm|lowerarm|hand|wrist|thumb|index|middle|ring|pinky)_/;
const TORSO = /^(pelvis|spine_0[1-5]|clavicle_pec|thigh)/;
const SIDES = ['l', 'r'] as const;
/** A vertex this much (or more) on the arm bones is arm; this little (or less), torso. */
const ARM_SKIN = 0.98;
const TORSO_SKIN = 0.02;
/** Skin closer than this (m) at rest is one sample. */
const SPACING = 0.02;
/** Gap (m) the arm keeps from the torso: skin on skin just touching. */
export const CLEARANCE = 0.003;
/**
 * The upper arm is left out down to this far (m) above the elbow joint. When
 * the arms hang it meets the chest's side (soft tissue, hidden under the arm):
 * pushing it clear held the procedural relaxed arms 16° out, the hands well
 * off the thighs. The elbow and everything below keep clear.
 */
export const ELBOW = 0.03;
/**
 * Most clothes count over the skin (m), on the arm and on the torso alike.
 * Cloth hanging farther off gives way: kept clear in full, an oversized
 * jacket's hem held the arms 26-40° out; at 2 cm a hoodie's sleeves held the
 * relaxed arms 8° out, at 1 cm 4°.
 */
export const CLOTH = 0.01;
/** Torso samples this much (m) farther than the nearest one blend into the surface. */
const KERNEL = 0.02;
/** Cell of the torso lookup (m): torso deeper or farther than this from an arm sample is not seen. */
const CELL = 0.03;
/** Cell of the garment lookup (m) when the clothes' thickness is read: cloth farther off is not seen. */
const COVER_CELL = 0.1;
/** Seconds for a push no longer needed to fade back to the clip's pose (to 1/e). */
export const RELEASE = 0.3;
/** Solver passes per arm and frame, and the largest turn a push may hold. */
const PASSES = 4;
const MAX_PUSH = 40 * DEG;
const TABLE = 1 << 13;
const MAX_NEAR = 1024;

/** Skin samples of one surface: where they are at rest and, each frame, now. */
interface Samples {
  count: number;
  vertex: Uint32Array;
  bones: Uint16Array;
  weights: Float32Array;
  /** Bind-space position and normal, body morphs applied (re-read when they change). */
  rest: Float32Array;
  restNormal: Float32Array;
  /** Thickness (m) of the clothes worn over each sample, up to CLOTH. */
  cover: Float32Array;
  world: Float32Array;
  normal: Float32Array;
}

interface Arm {
  bone: Bone;
  samples: Samples;
  /** Turn of the upper arm in its parent's frame, on top of the clip's (held, fading). */
  push: Quaternion;
  /** Samples the first pass of this frame found near the torso; later passes look at these only. */
  near: Uint8Array;
}

/** The parts of the body rig the arms collide with (see BodyRig). */
export interface CollisionBody {
  root: Object3D;
  mesh: SkinnedMesh;
  garments: readonly SkinnedMesh[];
}

/** What the body mesh looked like when the samples' rest positions were last read. */
interface MeshState {
  version: number;
  influences: number[];
  bind: number[];
}

const IDENTITY = new Quaternion();
const shoulder = new Vector3();
const lever = new Vector3();
const turn = new Vector3();
const best = new Vector3();
const parentPosition = new Vector3();
const parentScale = new Vector3();
const parentTurn = new Quaternion();
const parentInverse = new Quaternion();
const delta = new Quaternion();
const clip = new Quaternion();
const skinMatrix = new Matrix4();

const cellHash = (x: number, y: number, z: number) =>
  (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & (TABLE - 1);

const angleOf = (q: Quaternion) => 2 * Math.acos(Math.min(1, Math.abs(q.w)));

export class ArmCollider {
  private readonly body: CollisionBody;
  private mesh: SkinnedMesh | undefined;
  private state: MeshState | undefined;
  /** Garments (and their position versions) the covers were read from. */
  private worn: SkinnedMesh[] = [];
  private versions: number[] = [];
  private torso: Samples = toSamples([], undefined);
  private arms: Arm[] = [];
  /** Skin matrices (bone world x inverse bind, 16 floats each) of the bones the samples use. */
  private matrices = new Float32Array(0);
  private used: number[] = [];
  private readonly head = new Int32Array(TABLE);
  private next = new Int32Array(0);
  private readonly near = new Int32Array(MAX_NEAR);
  private readonly nearDistance = new Float32Array(MAX_NEAR);
  /**
   * Torso surface near the last point looked up: signed distance (m, + outside),
   * the clothes' thickness over it and its normal.
   */
  private distance = 0;
  private cover = 0;
  private readonly surfaceNormal = new Vector3();

  constructor(body: CollisionBody) {
    this.body = body;
  }

  /** How far each upper arm is turned out of the body now (radians). */
  get pushes(): Record<(typeof SIDES)[number], number> {
    const push = (side: string) => this.arms.find((arm) => arm.bone.name === `upperarm_${side}`);
    return {
      l: angleOf(push('l')?.push ?? IDENTITY),
      r: angleOf(push('r')?.push ?? IDENTITY),
    };
  }

  /**
   * Call once per frame, after everything else that turns the arms: turns each
   * upper arm out of the torso and leaves the skeleton's world matrices current.
   */
  step(dt: number): void {
    this.prepare();
    if (this.arms.length === 0) return;
    this.body.root.updateMatrixWorld(true);
    this.skin(this.torso, true);
    this.index(this.torso);
    const fade = 1 - Math.exp(-Math.max(0, dt) / RELEASE);
    for (const arm of this.arms) this.resolve(arm, fade);
  }

  private surfaces(): Samples[] {
    return [this.torso, ...this.arms.map((arm) => arm.samples)];
  }

  /**
   * Picks the samples for a new body mesh, re-reads them when its morphs or
   * bind move them, and reads the clothes' thickness when the garments change.
   */
  private prepare(): void {
    const { mesh, garments } = this.body;
    if (mesh !== this.mesh) {
      this.build(mesh);
      this.worn = [];
    } else if (!sameState(this.state!, mesh)) {
      this.state = meshState(mesh);
      for (const samples of this.surfaces()) readRest(samples, mesh);
    }
    const versions = garments.map(positionVersion);
    const changed =
      garments.length !== this.worn.length ||
      garments.some((garment, i) => garment !== this.worn[i] || versions[i] !== this.versions[i]);
    if (!changed) return;
    this.worn = [...garments];
    this.versions = versions;
    readCover(this.torso, garments, false);
    for (const arm of this.arms) readCover(arm.samples, garments, true);
  }

  private build(mesh: SkinnedMesh): void {
    const pushes = new Map(this.arms.map((arm) => [arm.bone.name, arm.push]));
    this.mesh = mesh;
    this.state = meshState(mesh);
    const { bones, boneInverses } = mesh.skeleton;
    const uppers = SIDES.map((side) => bones.find((bone) => bone.name === `upperarm_${side}`));
    if (!uppers[0] || !uppers[1]) {
      this.arms = [];
      return;
    }
    // Joints at rest, in the bind space the samples are read in.
    const rest = (bone: Object3D) =>
      new Vector3().setFromMatrixPosition(
        skinMatrix.copy(boneInverses[bones.indexOf(bone as Bone)]!).invert(),
      );
    const shoulders = uppers.map((bone) => rest(bone!));
    // How far from the shoulder the arm's samples start (see ELBOW).
    const reaches = uppers.map((bone, i) => {
      const elbow = bone!.children.find((child) => child.name.startsWith('lowerarm_'));
      return elbow ? rest(elbow).distanceTo(shoulders[i]!) - ELBOW : 0;
    });
    const [torso, left, right] = pick(mesh, shoulders, reaches).map((list) =>
      toSamples(list, mesh),
    );
    this.torso = torso!;
    this.next = new Int32Array(torso!.count);
    this.arms = [left!, right!].map((samples, i) => ({
      bone: uppers[i]!,
      samples,
      push: pushes.get(uppers[i]!.name)?.clone() ?? new Quaternion(),
      near: new Uint8Array(samples.count),
    }));
    const used = new Set<number>();
    for (const samples of this.surfaces()) {
      samples.bones.forEach((bone, k) => {
        if (samples.weights[k] !== 0) used.add(bone);
      });
    }
    this.used = [...used];
    this.matrices = new Float32Array(bones.length * 16);
  }

  /** Turns one upper arm out of the torso, on top of last frame's push fading toward none. */
  private resolve(arm: Arm, fade: number): void {
    const { bone, samples, push } = arm;
    const parent = bone.parent;
    if (!parent || samples.count === 0) return;
    clip.copy(bone.quaternion);
    push.slerp(IDENTITY, fade);
    for (let pass = 0; ; pass += 1) {
      bone.quaternion.copy(push).multiply(clip);
      bone.updateMatrixWorld(true);
      if (pass === PASSES || !this.worstTurn(arm, pass === 0)) break;
      // The world turn about the shoulder, in the parent's frame: P^-1 D P.
      parent.matrixWorld.decompose(parentPosition, parentTurn, parentScale);
      const angle = best.length();
      delta.setFromAxisAngle(best.divideScalar(angle), angle);
      delta.premultiply(parentInverse.copy(parentTurn).invert()).multiply(parentTurn);
      push.premultiply(delta);
      const total = angleOf(push);
      if (total > MAX_PUSH) push.slerp(IDENTITY, 1 - MAX_PUSH / total);
    }
  }

  /**
   * The turn about the shoulder (axis times angle, in `best`) that lifts the
   * arm sample needing the largest one out to the clearance; false when no
   * sample is in. The first pass of a frame notes which samples are near the
   * torso at all; the small turns after it bring no others near.
   */
  private worstTurn({ bone, samples, near }: Arm, first: boolean): boolean {
    this.skin(samples, false);
    shoulder.setFromMatrixPosition(bone.matrixWorld);
    let most = 0;
    const { world, cover } = samples;
    for (let i = 0; i < samples.count; i += 1) {
      if (!first && !near[i]) continue;
      const x = world[i * 3]!;
      const y = world[i * 3 + 1]!;
      const z = world[i * 3 + 2]!;
      const found = this.surface(x, y, z);
      if (first) near[i] = found ? 1 : 0;
      if (!found) continue;
      const need = CLEARANCE + cover[i]! + this.cover - this.distance;
      if (need <= 0) continue;
      const reach = lever.set(x, y, z).sub(shoulder).lengthSq();
      if (reach < 1e-6) continue;
      // The smallest turn that moves the sample `need` along the torso normal.
      turn.crossVectors(lever, this.surfaceNormal).multiplyScalar(need / reach);
      const size = turn.lengthSq();
      if (size > most) {
        most = size;
        best.copy(turn);
      }
    }
    return most > 0;
  }

  /**
   * The torso surface near a point: signed distance (m, + outside) in
   * `distance`, clothes' thickness in `cover` and normal in `surfaceNormal`,
   * blended over the torso samples up to KERNEL farther than the nearest one.
   * False when none is near.
   */
  private surface(x: number, y: number, z: number): boolean {
    const found = this.gather(x, y, z);
    let nearest = Infinity;
    for (let k = 0; k < found; k += 1) nearest = Math.min(nearest, this.nearDistance[k]!);
    if (nearest > CELL * CELL) return false;
    const radius = (Math.sqrt(nearest) + KERNEL) ** 2;
    const { world, normal, cover } = this.torso;
    let sum = 0;
    let thickness = 0;
    let weight = 0;
    this.surfaceNormal.set(0, 0, 0);
    for (let k = 0; k < found; k += 1) {
      const d = this.nearDistance[k]! / radius;
      if (d >= 1) continue;
      const w = (1 - d) * (1 - d);
      const i = this.near[k]!;
      const t = i * 3;
      const nx = normal[t]!;
      const ny = normal[t + 1]!;
      const nz = normal[t + 2]!;
      sum += w * ((x - world[t]!) * nx + (y - world[t + 1]!) * ny + (z - world[t + 2]!) * nz);
      thickness += w * cover[i]!;
      this.surfaceNormal.x += w * nx;
      this.surfaceNormal.y += w * ny;
      this.surfaceNormal.z += w * nz;
      weight += w;
    }
    if (weight === 0 || this.surfaceNormal.lengthSq() < 1e-12) return false;
    this.distance = sum / weight;
    this.cover = thickness / weight;
    this.surfaceNormal.normalize();
    return true;
  }

  /** Torso samples in the cells around a point, with their squared distances. */
  private gather(x: number, y: number, z: number): number {
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    const cz = Math.floor(z / CELL);
    const { world } = this.torso;
    let found = 0;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const cell = cellHash(cx + dx, cy + dy, cz + dz);
          for (let i = this.head[cell]!; i >= 0; i = this.next[i]!) {
            const t = i * 3;
            const d = (world[t]! - x) ** 2 + (world[t + 1]! - y) ** 2 + (world[t + 2]! - z) ** 2;
            // Hash collisions bring in samples from far cells; they drop out here.
            if (d > 4 * CELL * CELL || found === MAX_NEAR) continue;
            this.near[found] = i;
            this.nearDistance[found] = d;
            found += 1;
          }
        }
      }
    }
    return found;
  }

  private index(samples: Samples): void {
    this.head.fill(-1);
    const { world } = samples;
    for (let i = 0; i < samples.count; i += 1) {
      const cell = cellHash(
        Math.floor(world[i * 3]! / CELL),
        Math.floor(world[i * 3 + 1]! / CELL),
        Math.floor(world[i * 3 + 2]! / CELL),
      );
      this.next[i] = this.head[cell]!;
      this.head[cell] = i;
    }
  }

  /**
   * World positions of the samples, and with `normals` their normals, skinned
   * as the GPU does (attached bind mode). Only the torso's normals are read.
   */
  private skin(samples: Samples, normals: boolean): void {
    const { bones, boneInverses } = this.mesh!.skeleton;
    const m = this.matrices;
    for (const i of this.used) {
      skinMatrix.multiplyMatrices(bones[i]!.matrixWorld, boneInverses[i]!);
      m.set(skinMatrix.elements, i * 16);
    }
    const { rest, restNormal, world, normal, weights } = samples;
    for (let i = 0; i < samples.count; i += 1) {
      // The weighted sum of the bones' skin matrices (column-major, last row left out).
      let a0 = 0;
      let a1 = 0;
      let a2 = 0;
      let a4 = 0;
      let a5 = 0;
      let a6 = 0;
      let a8 = 0;
      let a9 = 0;
      let a10 = 0;
      let a12 = 0;
      let a13 = 0;
      let a14 = 0;
      for (let k = i * 4; k < i * 4 + 4; k += 1) {
        const w = weights[k]!;
        if (w === 0) continue;
        const o = samples.bones[k]! * 16;
        a0 += w * m[o]!;
        a1 += w * m[o + 1]!;
        a2 += w * m[o + 2]!;
        a4 += w * m[o + 4]!;
        a5 += w * m[o + 5]!;
        a6 += w * m[o + 6]!;
        a8 += w * m[o + 8]!;
        a9 += w * m[o + 9]!;
        a10 += w * m[o + 10]!;
        a12 += w * m[o + 12]!;
        a13 += w * m[o + 13]!;
        a14 += w * m[o + 14]!;
      }
      const t = i * 3;
      const x = rest[t]!;
      const y = rest[t + 1]!;
      const z = rest[t + 2]!;
      world[t] = a0 * x + a4 * y + a8 * z + a12;
      world[t + 1] = a1 * x + a5 * y + a9 * z + a13;
      world[t + 2] = a2 * x + a6 * y + a10 * z + a14;
      if (!normals) continue;
      const u = restNormal[t]!;
      const v = restNormal[t + 1]!;
      const s = restNormal[t + 2]!;
      const nx = a0 * u + a4 * v + a8 * s;
      const ny = a1 * u + a5 * v + a9 * s;
      const nz = a2 * u + a6 * v + a10 * s;
      const length = Math.hypot(nx, ny, nz) || 1;
      normal[t] = nx / length;
      normal[t + 1] = ny / length;
      normal[t + 2] = nz / length;
    }
  }
}

function meshState(mesh: SkinnedMesh): MeshState {
  return {
    version: positionVersion(mesh),
    influences: [...(mesh.morphTargetInfluences ?? [])],
    bind: [...mesh.bindMatrix.elements],
  };
}

function sameState(state: MeshState, mesh: SkinnedMesh): boolean {
  const influences = mesh.morphTargetInfluences ?? [];
  return (
    state.version === positionVersion(mesh) &&
    state.influences.length === influences.length &&
    state.influences.every((value, i) => value === influences[i]) &&
    state.bind.every((value, i) => value === mesh.bindMatrix.elements[i])
  );
}

function positionVersion(mesh: SkinnedMesh): number {
  const position = mesh.geometry.getAttribute('position') as Attribute;
  return 'isInterleavedBufferAttribute' in position ? position.data.version : position.version;
}

/** Share of a vertex's skin weight on the arm bones. */
function armWeight(index: Attribute, weight: Attribute, arm: readonly boolean[], v: number) {
  let sum = 0;
  for (let k = 0; k < 4; k += 1)
    if (arm[index.getComponent(v, k)]) sum += weight.getComponent(v, k);
  return sum;
}

/**
 * The body's torso, left arm and right arm samples: one vertex per SPACING
 * cube at rest. Arm samples start `reaches` (m) from each shoulder.
 */
function pick(mesh: SkinnedMesh, shoulders: Vector3[], reaches: number[]): number[][] {
  const picked: number[][] = [[], [], []];
  const geometry = mesh.geometry;
  const index = geometry.getAttribute('skinIndex') as Attribute | undefined;
  const weight = geometry.getAttribute('skinWeight') as Attribute | undefined;
  if (!index || !weight || !geometry.getAttribute('normal')) return picked;
  const names = mesh.skeleton.bones.map((bone) => bone.name);
  const arm = names.map((name) => ARM.test(name));
  const torso = names.map((name) => TORSO.test(name));
  const seen = [new Set<number>(), new Set<number>(), new Set<number>()];
  const point = new Float32Array(3);
  const position = new Vector3();
  const morphs = activeMorphs(mesh);
  for (let v = 0; v < index.count; v += 1) {
    let strongest = 0;
    let bone = 0;
    for (let k = 0; k < 4; k += 1) {
      const w = weight.getComponent(v, k);
      if (w > strongest) {
        strongest = w;
        bone = index.getComponent(v, k);
      }
    }
    const onArm = armWeight(index, weight, arm, v);
    let set: number;
    if (onArm >= ARM_SKIN) set = names[bone]!.endsWith('_l') ? 1 : 2;
    else if (onArm <= TORSO_SKIN && torso[bone]) set = 0;
    else continue;
    restPoint(mesh, morphs, v, point);
    position.fromArray(point);
    if (set > 0 && position.distanceTo(shoulders[set - 1]!) < reaches[set - 1]!) continue;
    const cell =
      (Math.floor(point[0]! / SPACING) + 1024) * 4194304 +
      (Math.floor(point[1]! / SPACING) + 1024) * 2048 +
      (Math.floor(point[2]! / SPACING) + 1024);
    if (seen[set]!.has(cell)) continue;
    seen[set]!.add(cell);
    picked[set]!.push(v);
  }
  return picked;
}

function toSamples(vertices: number[], mesh: SkinnedMesh | undefined): Samples {
  const count = vertices.length;
  const samples: Samples = {
    count,
    vertex: Uint32Array.from(vertices),
    bones: new Uint16Array(count * 4),
    weights: new Float32Array(count * 4),
    rest: new Float32Array(count * 3),
    restNormal: new Float32Array(count * 3),
    cover: new Float32Array(count),
    world: new Float32Array(count * 3),
    normal: new Float32Array(count * 3),
  };
  if (!mesh) return samples;
  const index = mesh.geometry.getAttribute('skinIndex') as Attribute;
  const weight = mesh.geometry.getAttribute('skinWeight') as Attribute;
  vertices.forEach((vertex, i) => {
    for (let k = 0; k < 4; k += 1) {
      samples.bones[i * 4 + k] = index.getComponent(vertex, k);
      samples.weights[i * 4 + k] = weight.getComponent(vertex, k);
    }
  });
  readRest(samples, mesh);
  return samples;
}

/** Re-reads the samples' rest positions and normals (bind space, morphs applied). */
function readRest(samples: Samples, mesh: SkinnedMesh): void {
  const morphs = activeMorphs(mesh);
  const point = new Float32Array(3);
  const direction = new Vector3();
  const normal = mesh.geometry.getAttribute('normal') as Attribute;
  for (let i = 0; i < samples.count; i += 1) {
    const v = samples.vertex[i]!;
    restPoint(mesh, morphs, v, point);
    samples.rest.set(point, i * 3);
    direction
      .set(normal.getX(v), normal.getY(v), normal.getZ(v))
      .transformDirection(mesh.bindMatrix)
      .toArray(samples.restNormal, i * 3);
  }
}

/**
 * How thick the clothes are over each sample, up to CLOTH: how far out along
 * the skin's normal the farthest garment point lies, among those in a cone
 * about it (at rest). Arm samples read sleeves (garment points on the arm
 * bones), the torso the rest.
 */
function readCover(samples: Samples, garments: readonly SkinnedMesh[], sleeves: boolean): void {
  samples.cover.fill(0);
  const points: number[] = [];
  const cells = new Map<number, number[]>();
  const point = new Float32Array(3);
  for (const garment of garments) {
    const index = garment.geometry.getAttribute('skinIndex') as Attribute | undefined;
    const weight = garment.geometry.getAttribute('skinWeight') as Attribute | undefined;
    if (!index || !weight) continue;
    const arm = garment.skeleton.bones.map((bone) => ARM.test(bone.name));
    const morphs = activeMorphs(garment);
    for (let v = 0; v < index.count; v += 1) {
      if (armWeight(index, weight, arm, v) >= 0.5 !== sleeves) continue;
      restPoint(garment, morphs, v, point);
      const cell = cellHash(
        Math.floor(point[0]! / COVER_CELL),
        Math.floor(point[1]! / COVER_CELL),
        Math.floor(point[2]! / COVER_CELL),
      );
      const list = cells.get(cell) ?? [];
      if (list.length === 0) cells.set(cell, list);
      list.push(points.length);
      points.push(point[0]!, point[1]!, point[2]!);
    }
  }
  if (points.length === 0) return;
  const { rest, restNormal } = samples;
  for (let i = 0; i < samples.count; i += 1) {
    const [x, y, z] = [rest[i * 3]!, rest[i * 3 + 1]!, rest[i * 3 + 2]!];
    const [nx, ny, nz] = [restNormal[i * 3]!, restNormal[i * 3 + 1]!, restNormal[i * 3 + 2]!];
    const cx = Math.floor(x / COVER_CELL);
    const cy = Math.floor(y / COVER_CELL);
    const cz = Math.floor(z / COVER_CELL);
    let most = 0;
    for (let dx = -1; dx <= 1 && most < CLOTH; dx += 1) {
      for (let dy = -1; dy <= 1 && most < CLOTH; dy += 1) {
        for (let dz = -1; dz <= 1 && most < CLOTH; dz += 1) {
          for (const p of cells.get(cellHash(cx + dx, cy + dy, cz + dz)) ?? []) {
            const ux = points[p]! - x;
            const uy = points[p + 1]! - y;
            const uz = points[p + 2]! - z;
            const out = ux * nx + uy * ny + uz * nz;
            if (out <= most) continue;
            // Within a 45° cone (plus a centimetre) about the normal: cloth over
            // this skin, not over the next limb along.
            const side = ux * ux + uy * uy + uz * uz - out * out;
            if (side > (out + 0.01) ** 2) continue;
            most = Math.min(CLOTH, out);
          }
        }
      }
    }
    samples.cover[i] = most;
  }
}

interface ActiveMorph {
  morph: Attribute;
  weight: number;
}

function activeMorphs(mesh: SkinnedMesh): ActiveMorph[] {
  const morphs = mesh.geometry.morphAttributes.position ?? [];
  const influences = mesh.morphTargetInfluences ?? [];
  return morphs.flatMap((morph, m) => {
    const weight = influences[m] ?? 0;
    return weight !== 0 ? [{ morph: morph as Attribute, weight }] : [];
  });
}

/** Bind-space position of vertex v (morphs applied), written to out[0..2]. */
function restPoint(
  mesh: SkinnedMesh,
  morphs: readonly ActiveMorph[],
  v: number,
  out: Float32Array,
): void {
  const position = mesh.geometry.getAttribute('position') as Attribute;
  const bx = position.getX(v);
  const by = position.getY(v);
  const bz = position.getZ(v);
  let x = bx;
  let y = by;
  let z = bz;
  const relative = mesh.geometry.morphTargetsRelative;
  for (const { morph, weight } of morphs) {
    x += weight * (morph.getX(v) - (relative ? 0 : bx));
    y += weight * (morph.getY(v) - (relative ? 0 : by));
    z += weight * (morph.getZ(v) - (relative ? 0 : bz));
  }
  const e = mesh.bindMatrix.elements;
  out[0] = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
  out[1] = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
  out[2] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
}
