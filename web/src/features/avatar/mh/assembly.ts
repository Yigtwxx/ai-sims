import { syncGarmentMorphs } from './garments';
import {
  BufferGeometry,
  Matrix3,
  Matrix4,
  type Quaternion,
  Skeleton,
  Vector3,
  type Bone,
  type BufferAttribute,
  type InterleavedBufferAttribute,
  type Material,
  type Mesh,
  type Object3D,
  type SkinnedMesh,
} from 'three';

/**
 * Assembly of a MetaHuman character from the converter's GLBs (contract:
 * docs/specs/2026-10-20-metahuman-web-assets.md): the body skeleton is the
 * master, the head's skin is re-pointed at the body bones of the same name, and
 * body sliders move both the mesh (morphs) and the joints (parent-space deltas).
 */

export type Vec3Tuple = [number, number, number];

/** extras.mh.body_joint_deltas: slider end ("body_height_max") -> bone -> offset (m). */
export type JointDeltas = Record<string, Record<string, Vec3Tuple>>;

export interface BodyRig {
  /** Root of the cloned body scene. */
  root: Object3D;
  /** The body skinned mesh (morph targets body_<slider>_min/max). */
  mesh: SkinnedMesh;
  bones: Map<string, Bone>;
  /** Neutral local transforms, restored before every rebind. */
  restPosition: Map<string, Vector3>;
  restQuaternion: Map<string, Quaternion>;
  /** Joint positions with the current body sliders applied (the pose clips move from). */
  sliderPosition: Map<string, Vector3>;
  jointDeltas: JointDeltas;
  /** Head neck snapped to this body's neck; re-snapped whenever the sliders move it. */
  seam?: NeckSeamBinding;
  /** Worn garments: they share the body skeleton and follow its slider morphs. */
  garments: SkinnedMesh[];
}

export function collectBones(root: Object3D): Map<string, Bone> {
  const bones = new Map<string, Bone>();
  root.traverse((node) => {
    if ((node as Bone).isBone && !bones.has(node.name)) bones.set(node.name, node as Bone);
  });
  return bones;
}

export function collectSkinnedMeshes(root: Object3D): SkinnedMesh[] {
  const meshes: SkinnedMesh[] = [];
  root.traverse((node) => {
    if ((node as SkinnedMesh).isSkinnedMesh) meshes.push(node as SkinnedMesh);
  });
  return meshes;
}

/** Morph meshes (any mesh with a morph dictionary), e.g. every head primitive. */
export function collectMorphMeshes(root: Object3D): Mesh[] {
  const meshes: Mesh[] = [];
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (mesh.isMesh && mesh.morphTargetDictionary && mesh.morphTargetInfluences) meshes.push(mesh);
  });
  return meshes;
}

/** extras.mh of a loaded GLB (the converter writes it on the scene or the asset). */
export function mhExtras(scene: Object3D, json?: { extras?: unknown }): Record<string, unknown> {
  const fromScene = (scene.userData as { mh?: Record<string, unknown> }).mh;
  if (fromScene) return fromScene;
  const fromJson = (json?.extras as { mh?: Record<string, unknown> } | undefined)?.mh;
  return fromJson ?? {};
}

export function createBodyRig(root: Object3D, jointDeltas: JointDeltas): BodyRig {
  const mesh = collectSkinnedMeshes(root)[0];
  if (!mesh) throw new Error('Body GLB has no skinned mesh');
  const bones = collectBones(root);
  const restPosition = new Map<string, Vector3>();
  const restQuaternion = new Map<string, Quaternion>();
  for (const [name, bone] of bones) {
    restPosition.set(name, bone.position.clone());
    restQuaternion.set(name, bone.quaternion.clone());
  }
  const sliderPosition = new Map([...restPosition].map(([name, p]) => [name, p.clone()]));
  return {
    root,
    mesh,
    bones,
    restPosition,
    restQuaternion,
    sliderPosition,
    jointDeltas,
    garments: [],
  };
}

/**
 * Re-points the head's skin at the body skeleton. Shared bones (spine_04 …
 * head) become the body's; face-only bones (eyes, facial root) move under the
 * body bone their parent maps to, keeping their local transform. Returns the
 * head meshes, ready to be added to the body root.
 */
export function attachHead(head: Object3D, body: BodyRig): SkinnedMesh[] {
  const meshes = collectSkinnedMeshes(head);
  const headBones = collectBones(head);
  for (const bone of headBones.values()) {
    if (body.bones.has(bone.name)) continue;
    const parent = bone.parent as Bone | null;
    if (parent?.isBone && body.bones.has(parent.name)) body.bones.get(parent.name)!.add(bone);
  }
  // The primitives share one glTF skin: give them one skeleton too. The
  // renderer updates and uploads a skeleton's ~870 bone matrices once per
  // render pass, so one per primitive multiplied that work ninefold.
  const shared: Skeleton[] = [];
  for (const mesh of meshes) {
    const { bones, boneInverses } = mesh.skeleton;
    const remapped = bones.map((bone) => body.bones.get(bone.name) ?? bone);
    const skeleton =
      shared.find((candidate) => sameSkin(candidate, remapped, boneInverses)) ??
      new Skeleton(
        remapped,
        boneInverses.map((inverse) => inverse.clone()),
      );
    if (!shared.includes(skeleton)) shared.push(skeleton);
    mesh.bind(skeleton, mesh.bindMatrix);
    mesh.frustumCulled = false;
  }
  return meshes;
}

function sameSkin(skeleton: Skeleton, bones: readonly Bone[], inverses: readonly Matrix4[]) {
  return (
    skeleton.bones.length === bones.length &&
    skeleton.bones.every((bone, i) => bone === bones[i]) &&
    skeleton.boneInverses.every((inverse, i) => inverse.equals(inverses[i]!))
  );
}

export const BODY_SLIDER_IDS = [
  'height',
  'weight',
  'muscle',
  'chest',
  'waist',
  'hips',
  'shoulders',
] as const;
export type BodySliderId = (typeof BODY_SLIDER_IDS)[number];

/** Morph weight of each slider end for a slider value in -1..1. */
export function sliderEndWeights(value: number): { min: number; max: number } {
  const v = Math.max(-1, Math.min(1, value));
  return { min: Math.max(0, -v), max: Math.max(0, v) };
}

const scratch = new Vector3();

/**
 * Applies body slider values: morph weights on the body mesh, joint offsets on
 * the skeleton, then rebinds the body so its bind-space morphs are not applied
 * twice (the converter's note in extras). The head keeps its own inverse bind
 * matrices on purpose: it follows the moved neck and head bones rigidly.
 * Bones are reset to their rest rotation first; an animation mixer re-applies
 * its pose on the next frame.
 */
export function applyBodySliders(
  body: BodyRig,
  values: Partial<Record<BodySliderId, number>>,
): void {
  const { mesh } = body;
  const dictionary = mesh.morphTargetDictionary ?? {};
  const influences = mesh.morphTargetInfluences ?? [];
  const ends: [string, number][] = [];
  for (const id of BODY_SLIDER_IDS) {
    const { min, max } = sliderEndWeights(values[id] ?? 0);
    for (const [end, weight] of [
      [`body_${id}_min`, min],
      [`body_${id}_max`, max],
    ] as const) {
      const index = dictionary[end];
      if (index !== undefined) influences[index] = weight;
      if (weight > 0) ends.push([end, weight]);
    }
  }

  for (const [name, bone] of body.bones) {
    bone.position.copy(body.restPosition.get(name)!);
    bone.quaternion.copy(body.restQuaternion.get(name)!);
    bone.scale.set(1, 1, 1);
    for (const [end, weight] of ends) {
      const delta = body.jointDeltas[end]?.[name];
      if (delta)
        bone.position.add(scratch.set(delta[0], delta[1], delta[2]).multiplyScalar(weight));
    }
    body.sliderPosition.get(name)!.copy(bone.position);
  }
  body.root.updateMatrixWorld(true);
  // Re-bake the rest pose: inverse bind matrices from the moved joints. In
  // three's attached bind mode this is valid even while the turntable is turned.
  mesh.bind(mesh.skeleton);
  // Garments share the skeleton, so the new inverse binds are theirs already;
  // the bind matrix is not. It holds the body's world transform at the bind,
  // turntable included: a garment keeping the old one would swing off the body
  // by however far the character was turned since.
  for (const garment of body.garments) {
    garment.bindMatrix.copy(mesh.bindMatrix);
    garment.bindMatrixInverse.copy(mesh.bindMatrixInverse);
    syncGarmentMorphs(garment, body);
  }
  if (body.seam) snapNeckSeam(body.seam);
}

/**
 * Gives skinned meshes the bind-pose bounds of their geometry. Otherwise three
 * sizes a skinned mesh's bounds the first time it sorts it, walking every
 * vertex through its bones: a third of a second for a newly shown character.
 */
export function presetSkinnedBounds(root: Object3D): void {
  root.traverse((node) => {
    const mesh = node as SkinnedMesh;
    if (!mesh.isSkinnedMesh || mesh.boundingSphere) return;
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    mesh.boundingSphere = mesh.geometry.boundingSphere!.clone();
  });
}

/** extras.mh.neck_seam written by the converter for heads and bodies. */
export interface NeckSeamExtras {
  /** Material name of the primitive the indices refer to ("head", "body"). */
  primitive: string;
  /** DNA position indices of the open neck boundary, in loop order. */
  boundary: number[];
  /** Primitive vertex indices near the seam and their falloff (1 at the boundary). */
  vertices: number[];
  weights: number[];
}

/**
 * Head neck vertices bound to the body neck. A preset head is sculpted for its
 * own body, so on any other body (or after a slider) the two open boundaries
 * miss each other by a few millimetres and the backdrop shows through the
 * crack. Snapping moves the head boundary onto the body boundary (same skin
 * weights, so it stays closed while the neck animates) and fades the offset out
 * over the converter's seam rings.
 */
export interface NeckSeamBinding {
  head: SkinnedMesh;
  body: SkinnedMesh;
  /** Head vertices the seam moves, their falloff and their positions as loaded. */
  vertices: Int32Array;
  weights: Float32Array;
  rest: Float32Array;
  /** Per seam vertex: the two nearest boundary slots and the blend between them. */
  slotA: Int32Array;
  slotB: Int32Array;
  blend: Float32Array;
  /** Per seam vertex: true when it lies on the boundary itself. */
  onBoundary: Uint8Array;
  /** Per boundary seam vertex: unit direction across the seam, away from the head (rest space). */
  outward: Float32Array;
  /** Per boundary slot: the body vertex it is welded to. */
  bodyVertex: Int32Array;
}

type Attribute = BufferAttribute | InterleavedBufferAttribute;

const DNA_POSITION = '_dna_position';
/** How far (m) the head boundary reaches past the seam, and how deep under the body skin. */
const SEAM_SKIRT_OUT = 0.0015;
const SEAM_SKIRT_IN = 0.0004;

/** First primitive vertex of each DNA position (glTF splits positions at UV seams). */
function vertexOfPosition(geometry: BufferGeometry): Map<number, number> {
  const map = new Map<number, number>();
  const attribute = geometry.getAttribute(DNA_POSITION) as Attribute | undefined;
  if (!attribute) return map;
  for (let v = 0; v < attribute.count; v += 1) {
    const position = Math.round(attribute.getX(v));
    if (!map.has(position)) map.set(position, v);
  }
  return map;
}

/**
 * Cyclic shift and direction that best line up two boundary loops walked from
 * arbitrary starts: b[(shift + direction * i) mod n] pairs with a[i].
 */
export function alignLoops(
  a: readonly Vector3[],
  b: readonly Vector3[],
): { shift: number; direction: 1 | -1 } {
  const n = a.length;
  let best = { shift: 0, direction: 1 as 1 | -1, cost: Infinity };
  for (const direction of [1, -1] as const) {
    for (let shift = 0; shift < n; shift += 1) {
      let cost = 0;
      for (let i = 0; i < n && cost < best.cost; i += 1) {
        cost += a[i]!.distanceToSquared(b[(((shift + direction * i) % n) + n) % n]!);
      }
      if (cost < best.cost) best = { shift, direction, cost };
    }
  }
  return { shift: best.shift, direction: best.direction };
}

const skinScratch = new Matrix4();

/** World transform of one skinned vertex's bind-space position (attached bind mode). */
function skinTransform(mesh: SkinnedMesh, vertex: number, target: Matrix4): Matrix4 {
  const { bones, boneInverses } = mesh.skeleton;
  const index = mesh.geometry.getAttribute('skinIndex') as Attribute;
  const weight = mesh.geometry.getAttribute('skinWeight') as Attribute;
  const out = target.elements;
  out.fill(0);
  for (let k = 0; k < 4; k += 1) {
    const w = weight.getComponent(vertex, k);
    if (w === 0) continue;
    const bone = index.getComponent(vertex, k);
    skinScratch.multiplyMatrices(bones[bone]!.matrixWorld, boneInverses[bone]!);
    const m = skinScratch.elements;
    for (let e = 0; e < 16; e += 1) out[e]! += w * m[e]!;
  }
  return target.multiply(mesh.bindMatrix);
}

const SEAM_OWNED = ['position', 'normal', 'skinIndex', 'skinWeight'];
interface SeamCopy {
  copy: BufferGeometry;
  /** The owned attributes as loaded, de-interleaved like the copy's. */
  loaded: Map<string, ArrayLike<number>>;
}
/** The seam copy made of each head geometry, reused by the next character with that head. */
const seamCopies = new WeakMap<BufferGeometry, SeamCopy>();

/**
 * Copy of a geometry that owns the attributes the seam rewrites and shares the
 * rest. One copy per head, restored to the loaded values on every bind: the
 * renderer keys a geometry's morph texture (67 targets for a head) by the
 * geometry, so a fresh copy rebuilt it, a ~0.3 s freeze, every time a face was
 * picked again. Two characters with one head on different bodies at the same
 * time would share the snapped seam; no page shows that.
 */
function ownSeamAttributes(geometry: BufferGeometry): BufferGeometry {
  const cached = seamCopies.get(geometry);
  if (cached) {
    for (const [name, values] of cached.loaded) {
      const attribute = cached.copy.getAttribute(name) as BufferAttribute;
      (attribute.array as unknown as { set(values: ArrayLike<number>): void }).set(values);
      attribute.needsUpdate = true;
    }
    return cached.copy;
  }
  const copy = new BufferGeometry();
  const loaded = new Map<string, ArrayLike<number>>();
  copy.setIndex(geometry.index);
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    if (!SEAM_OWNED.includes(name)) {
      copy.setAttribute(name, attribute);
      continue;
    }
    // clone() de-interleaves; keep a second copy of the values to restore from.
    const owned = attribute.clone() as BufferAttribute;
    copy.setAttribute(name, owned);
    loaded.set(name, owned.array.slice());
  }
  seamCopies.set(geometry, { copy, loaded });
  copy.morphAttributes = geometry.morphAttributes;
  copy.morphTargetsRelative = geometry.morphTargetsRelative;
  for (const group of geometry.groups) copy.addGroup(group.start, group.count, group.materialIndex);
  copy.boundingBox = geometry.boundingBox?.clone() ?? null;
  copy.boundingSphere = geometry.boundingSphere?.clone() ?? null;
  copy.name = geometry.name;
  copy.userData = geometry.userData;
  return copy;
}

function materialName(mesh: Mesh): string {
  const material = mesh.material as Material | Material[];
  return Array.isArray(material) ? (material[0]?.name ?? '') : material.name;
}

/**
 * Binds the head's neck to the body's: pairs the two boundary loops, copies the
 * body's skin weights onto the head boundary and snaps it once. Call after
 * `attachHead`, with the whole character's world matrices up to date. Returns
 * undefined when either GLB lacks seam data (the character still renders).
 */
export function bindNeckSeam(
  headMeshes: readonly SkinnedMesh[],
  headSeam: NeckSeamExtras | undefined,
  body: BodyRig,
  bodySeam: NeckSeamExtras | undefined,
): NeckSeamBinding | undefined {
  const head = headMeshes.find((mesh) => materialName(mesh) === headSeam?.primitive);
  if (!head || !headSeam || !bodySeam) return undefined;
  const n = headSeam.boundary.length;
  if (n === 0 || n !== bodySeam.boundary.length) return undefined;

  head.geometry = ownSeamAttributes(head.geometry);
  const headVertexOf = vertexOfPosition(head.geometry);
  const bodyVertexOf = vertexOfPosition(body.mesh.geometry);
  const headBoundary = headSeam.boundary.map((p) => headVertexOf.get(p));
  const bodyBoundary = bodySeam.boundary.map((p) => bodyVertexOf.get(p));
  if (headBoundary.includes(undefined) || bodyBoundary.includes(undefined)) return undefined;

  // Pair the loops where they sit now (head as loaded, body at rest).
  const transform = new Matrix4();
  const headPoints = headBoundary.map((v) =>
    new Vector3()
      .fromBufferAttribute(head.geometry.attributes.position as Attribute, v!)
      .applyMatrix4(skinTransform(head, v!, transform)),
  );
  const bodyPoints = bodyBoundary.map((v) =>
    body.mesh.getVertexPosition(v!, new Vector3()).applyMatrix4(body.mesh.matrixWorld),
  );
  const { shift, direction } = alignLoops(headPoints, bodyPoints);
  const bodyVertex = new Int32Array(n);
  for (let i = 0; i < n; i += 1)
    bodyVertex[i] = bodyBoundary[(((shift + direction * i) % n) + n) % n]!;

  const slotOfPosition = new Map(headSeam.boundary.map((p, slot) => [p, slot]));
  const dna = head.geometry.getAttribute(DNA_POSITION) as Attribute;
  const position = head.geometry.attributes.position as Attribute;
  const count = headSeam.vertices.length;
  const binding: NeckSeamBinding = {
    head,
    body: body.mesh,
    vertices: Int32Array.from(headSeam.vertices),
    weights: Float32Array.from(headSeam.weights),
    rest: new Float32Array(count * 3),
    slotA: new Int32Array(count),
    slotB: new Int32Array(count),
    blend: new Float32Array(count),
    onBoundary: new Uint8Array(count),
    outward: new Float32Array(count * 3),
    bodyVertex,
  };
  const restBoundary = headBoundary.map((v) => new Vector3().fromBufferAttribute(position, v!));
  const point = new Vector3();
  for (let i = 0; i < count; i += 1) {
    const vertex = binding.vertices[i]!;
    point.fromBufferAttribute(position, vertex).toArray(binding.rest, i * 3);
    const slot = slotOfPosition.get(Math.round(dna.getX(vertex)));
    if (slot !== undefined) {
      binding.slotA[i] = binding.slotB[i] = slot;
      binding.onBoundary[i] = 1;
      continue;
    }
    // Rings follow the two nearest boundary vertices, by inverse distance.
    let a = 0;
    let b = 0;
    let da = Infinity;
    let db = Infinity;
    restBoundary.forEach((boundaryPoint, slot) => {
      const d = boundaryPoint.distanceTo(point);
      if (d < da) [b, db, a, da] = [a, da, slot, d];
      else if (d < db) [b, db] = [slot, d];
    });
    binding.slotA[i] = a;
    binding.slotB[i] = b;
    binding.blend[i] = da + db > 0 ? da / (da + db) : 0;
  }
  setSeamOutward(binding);

  copyBoundarySkin(binding);
  snapNeckSeam(binding);
  return binding;
}

/**
 * Direction across the seam for each boundary vertex: from the nearest ring
 * vertex (head side) through the boundary vertex.
 */
function setSeamOutward(binding: NeckSeamBinding): void {
  const { rest, onBoundary, outward } = binding;
  const count = onBoundary.length;
  const p = new Vector3();
  const q = new Vector3();
  for (let i = 0; i < count; i += 1) {
    if (!onBoundary[i]) continue;
    p.fromArray(rest, i * 3);
    let nearest = -1;
    let best = Infinity;
    for (let j = 0; j < count; j += 1) {
      if (onBoundary[j]) continue;
      const d = p.distanceToSquared(q.fromArray(rest, j * 3));
      if (d < best) [best, nearest] = [d, j];
    }
    if (nearest < 0) continue;
    p.sub(q.fromArray(rest, nearest * 3))
      .normalize()
      .toArray(outward, i * 3);
  }
}

/** Gives every head boundary vertex the skin of the body vertex it is welded to. */
function copyBoundarySkin(binding: NeckSeamBinding): void {
  const { head, body } = binding;
  const headIndex = head.geometry.getAttribute('skinIndex') as Attribute;
  const headWeight = head.geometry.getAttribute('skinWeight') as Attribute;
  const bodyIndex = body.geometry.getAttribute('skinIndex') as Attribute;
  const bodyWeight = body.geometry.getAttribute('skinWeight') as Attribute;
  const headSlot = new Map(head.skeleton.bones.map((bone, slot) => [bone, slot]));
  for (let i = 0; i < binding.vertices.length; i += 1) {
    if (!binding.onBoundary[i]) continue;
    const vertex = binding.vertices[i]!;
    const source = binding.bodyVertex[binding.slotA[i]!]!;
    const mapped: [number, number][] = [];
    for (let k = 0; k < 4; k += 1) {
      const w = bodyWeight.getComponent(source, k);
      if (w === 0) continue;
      const slot = headSlot.get(body.skeleton.bones[bodyIndex.getComponent(source, k)]!);
      if (slot === undefined) break;
      mapped.push([slot, w]);
    }
    const total = mapped.reduce((sum, [, w]) => sum + w, 0);
    if (total < 0.999) continue; // a body-only bone: keep the head's own weights
    for (let k = 0; k < 4; k += 1) {
      headIndex.setComponent(vertex, k, mapped[k]?.[0] ?? 0);
      headWeight.setComponent(vertex, k, mapped[k]?.[1] ?? 0);
    }
  }
  headIndex.needsUpdate = true;
  headWeight.needsUpdate = true;
}

/**
 * Moves the head seam onto the body neck as it is now (morphs and joint
 * offsets included). Bones must be at rest; `applyBodySliders` calls this.
 */
export function snapNeckSeam(binding: NeckSeamBinding): void {
  const { head, body } = binding;
  const slots = binding.bodyVertex.length;
  const position = head.geometry.attributes.position as Attribute;
  const normal = head.geometry.attributes.normal as Attribute | undefined;
  const bodyNormal = body.geometry.attributes.normal as Attribute | undefined;
  const bodyNormalMorphs = body.geometry.morphAttributes.normal;
  const influences = body.morphTargetInfluences ?? [];

  const transform = new Matrix4();
  const linear = new Matrix3();
  const target = new Vector3();
  const local = new Vector3();
  const seamNormal = new Vector3();
  const offsets = new Float32Array(slots * 3);
  const targets: Vector3[] = [];
  const targetNormals: Vector3[] = [];
  for (let slot = 0; slot < slots; slot += 1) {
    const vertex = binding.bodyVertex[slot]!;
    targets.push(body.getVertexPosition(vertex, new Vector3()).applyMatrix4(body.matrixWorld));
    const n = new Vector3();
    if (bodyNormal) {
      n.fromBufferAttribute(bodyNormal, vertex);
      bodyNormalMorphs?.forEach((morph, m) => {
        const w = influences[m] ?? 0;
        if (w !== 0) n.addScaledVector(local.fromBufferAttribute(morph, vertex), w);
      });
      n.applyMatrix3(linear.setFromMatrix4(skinTransform(body, vertex, transform))).normalize();
    }
    targetNormals.push(n);
  }

  // Boundary vertices: solve rest position = S⁻¹ (target − t) under their own skin.
  for (let i = 0; i < binding.vertices.length; i += 1) {
    if (!binding.onBoundary[i]) continue;
    const vertex = binding.vertices[i]!;
    const slot = binding.slotA[i]!;
    skinTransform(head, vertex, transform);
    const e = transform.elements;
    linear.setFromMatrix4(transform).invert();
    target
      .copy(targets[slot]!)
      .sub(local.set(e[12]!, e[13]!, e[14]!))
      .applyMatrix3(linear);
    for (let c = 0; c < 3; c += 1)
      offsets[slot * 3 + c] = target.getComponent(c) - binding.rest[i * 3 + c]!;
    const n = seamNormal.copy(targetNormals[slot]!).applyMatrix3(linear).normalize();
    if (normal && bodyNormal) normal.setXYZ(vertex, n.x, n.y, n.z);
    // Skirt: the head and body skin the shared edge with their own matrices,
    // so it never matches to the bit and sub-pixel cracks show the backdrop.
    // Tuck the head boundary just past the edge and under the body skin.
    if (bodyNormal) {
      target
        .addScaledVector(local.fromArray(binding.outward, i * 3), SEAM_SKIRT_OUT)
        .addScaledVector(n, -SEAM_SKIRT_IN);
    }
    position.setXYZ(vertex, target.x, target.y, target.z);
  }
  // Rings: the offset of their two boundary neighbours, faded out by the falloff.
  for (let i = 0; i < binding.vertices.length; i += 1) {
    if (binding.onBoundary[i]) continue;
    const a = binding.slotA[i]! * 3;
    const b = binding.slotB[i]! * 3;
    const t = binding.blend[i]!;
    const w = binding.weights[i]!;
    position.setXYZ(
      binding.vertices[i]!,
      binding.rest[i * 3]! + w * ((1 - t) * offsets[a]! + t * offsets[b]!),
      binding.rest[i * 3 + 1]! + w * ((1 - t) * offsets[a + 1]! + t * offsets[b + 1]!),
      binding.rest[i * 3 + 2]! + w * ((1 - t) * offsets[a + 2]! + t * offsets[b + 2]!),
    );
  }
  position.needsUpdate = true;
  if (normal) normal.needsUpdate = true;
}

/** Sets one named morph on every mesh that has it (all head primitives share names). */
export function setMorph(meshes: readonly Mesh[], name: string, weight: number): void {
  for (const mesh of meshes) {
    const index = mesh.morphTargetDictionary?.[name];
    if (index !== undefined) mesh.morphTargetInfluences![index] = weight;
  }
}

/** Morph name -> weight snapshot (reads the first mesh that has each name). */
export function readMorphs(meshes: readonly Mesh[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const mesh of meshes) {
    for (const [name, index] of Object.entries(mesh.morphTargetDictionary ?? {})) {
      if (!(name in out)) out[name] = mesh.morphTargetInfluences![index] ?? 0;
    }
  }
  return out;
}
