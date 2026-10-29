import {
  BufferAttribute,
  BufferGeometry,
  Matrix4,
  Vector3,
  type Bone,
  type InterleavedBufferAttribute,
  type Material,
  type Object3D,
  type Skeleton,
  type SkinnedMesh,
} from 'three';

import { collectBones, collectSkinnedMeshes } from './assembly';

/**
 * Face blending (the creator's `face.blend`). Every converted MetaHuman head
 * shares one topology: the same primitives, vertex order, 67 morph targets and
 * joints. A blend moves the worn head part of the way towards other heads:
 * rest positions and normals, the ARKit and viseme morph deltas (so the lips
 * still close and the lids still meet on the blended shape), the face-only
 * joints (the eyes turn about the blended eyeball centres) and the inverse
 * bind matrices that go with them.
 */

/** A head to lean towards: its loaded GLB scene (read, never written) and weight 0..1. */
export interface FaceBlendSource {
  root: Object3D;
  weight: number;
}

type Attribute = BufferAttribute | InterleavedBufferAttribute;
type TypedArray =
  Float32Array | Int8Array | Int16Array | Int32Array | Uint8Array | Uint16Array | Uint32Array;
type TypedArrayConstructor = new (length: number) => TypedArray;

const DNA_POSITION = '_dna_position';

/**
 * Weights towards each source. Each slider says how far the face leans towards
 * that face; together they never pass the source faces themselves: past a
 * total of 1 they are scaled down to sum to 1 (the worn face drops out).
 */
export function blendWeights(weights: readonly number[]): number[] {
  const clamped = weights.map((w) => Math.min(Math.max(w, 0), 1));
  const total = clamped.reduce((sum, w) => sum + w, 0);
  return total > 1 ? clamped.map((w) => w / total) : clamped;
}

/** An attribute's raw components, de-interleaved, in its own array type. */
function components(attribute: Attribute): TypedArray {
  if (!('isInterleavedBufferAttribute' in attribute && attribute.isInterleavedBufferAttribute)) {
    return (attribute as BufferAttribute).array as TypedArray;
  }
  const { data, offset, itemSize, count } = attribute;
  const source = data.array as TypedArray;
  const out = new (source.constructor as TypedArrayConstructor)(count * itemSize);
  for (let v = 0; v < count; v += 1) {
    for (let c = 0; c < itemSize; c += 1)
      out[v * itemSize + c] = source[v * data.stride + offset + c]!;
  }
  return out;
}

function typeOf(attribute: Attribute): TypedArrayConstructor {
  const array = 'data' in attribute && attribute.data ? attribute.data.array : attribute.array;
  return array.constructor as TypedArrayConstructor;
}

/** The value of one raw unit: glTF normalized integers map onto -1..1 (or 0..1). */
function unitOf(attribute: Attribute): number {
  if (!attribute.normalized) return 1;
  const type = typeOf(attribute);
  if (type === Int8Array) return 1 / 127;
  if (type === Int16Array) return 1 / 32767;
  if (type === Uint8Array) return 1 / 255;
  if (type === Uint16Array) return 1 / 65535;
  return 1;
}

const isInterleaved = (attribute: Attribute): attribute is InterleavedBufferAttribute =>
  'isInterleavedBufferAttribute' in attribute && attribute.isInterleavedBufferAttribute;

/**
 * acc[i] += w · attribute[i] over the attribute's raw components, read in
 * place (interleaved or not). The hot loop of a blend.
 */
function accumulate(acc: Float32Array, attribute: Attribute, w: number): void {
  if (isInterleaved(attribute)) {
    const { data, offset, itemSize, count } = attribute;
    const array = data.array as TypedArray;
    const stride = data.stride;
    for (let v = 0, i = 0; v < count; v += 1) {
      const at = v * stride + offset;
      for (let c = 0; c < itemSize; c += 1, i += 1) acc[i]! += w * array[at + c]!;
    }
    return;
  }
  const array = (attribute as BufferAttribute).array as TypedArray;
  for (let i = 0; i < acc.length; i += 1) acc[i]! += w * array[i]!;
}

const zeroCache = new WeakMap<Attribute, boolean>();

/**
 * Whether every component is 0, cached per attribute. Most morph targets move
 * only a few primitives (a blink leaves the teeth alone): skipping the
 * all-zero ones skips most of a head's ~14 M components.
 */
function isZero(attribute: Attribute): boolean {
  const cached = zeroCache.get(attribute);
  if (cached !== undefined) return cached;
  let zero = true;
  if (isInterleaved(attribute)) {
    const { data, offset, itemSize, count } = attribute;
    const array = data.array as TypedArray;
    for (let v = 0; v < count && zero; v += 1) {
      for (let c = 0; c < itemSize; c += 1) {
        if (array[v * data.stride + offset + c] !== 0) {
          zero = false;
          break;
        }
      }
    }
  } else {
    const array = (attribute as BufferAttribute).array as TypedArray;
    for (let i = 0; i < array.length; i += 1) {
      if (array[i] !== 0) {
        zero = false;
        break;
      }
    }
  }
  zeroCache.set(attribute, zero);
  return zero;
}

/** Same vertices and components per vertex; the component type may differ. */
function compatible(a: Attribute, b: Attribute): boolean {
  return a.count === b.count && a.itemSize === b.itemSize;
}

/**
 * base + Σ wᵢ (sourceᵢ − base) with Σ wᵢ ≤ 1 (see blendWeights). When every
 * input shares the base's component type it stays in that type: quantized
 * morph deltas share one scale across heads, and a convex mix of in-range
 * integers stays in range, so they are only rounded. Mixed inputs (the
 * converter writes some targets as float, others as int16) are blended in
 * value units into a float attribute. All-zero inputs return the base itself.
 */
export function blendAttribute(
  base: Attribute,
  sources: readonly Attribute[],
  weights: readonly number[],
): Attribute {
  if (isZero(base) && sources.every(isZero)) return base;
  const type = typeOf(base);
  const raw = sources.every((s) => typeOf(s) === type && s.normalized === base.normalized);
  const length = base.count * base.itemSize;
  const acc = new Float32Array(length);
  const baseWeight = 1 - weights.reduce((sum, w) => sum + w, 0);
  const unit = (attribute: Attribute) => (raw ? 1 : unitOf(attribute));
  if (!isZero(base)) accumulate(acc, base, baseWeight * unit(base));
  sources.forEach((source, s) => {
    if (!isZero(source)) accumulate(acc, source, weights[s]! * unit(source));
  });
  if (!raw) return new BufferAttribute(acc, base.itemSize, false);
  if (type === Float32Array) return new BufferAttribute(acc, base.itemSize, base.normalized);
  const out = new type(length);
  for (let i = 0; i < length; i += 1) out[i] = Math.round(acc[i]!);
  return new BufferAttribute(out, base.itemSize, base.normalized);
}

function renormalize(normal: Attribute): void {
  const n = new Vector3();
  for (let v = 0; v < normal.count; v += 1) {
    n.fromBufferAttribute(normal, v);
    const length = n.length();
    if (length > 1e-8) normal.setXYZ(v, n.x / length, n.y / length, n.z / length);
  }
}

function sameDna(a: BufferGeometry, b: BufferGeometry): boolean {
  const da = a.getAttribute(DNA_POSITION) as Attribute | undefined;
  const db = b.getAttribute(DNA_POSITION) as Attribute | undefined;
  if (!da || !db) return !da && !db;
  if (da.count !== db.count) return false;
  const ca = components(da);
  const cb = components(db);
  for (let i = 0; i < ca.length; i += 1) if (ca[i] !== cb[i]) return false;
  return true;
}

/** Whether a source geometry can be blended into the base: same vertices, attributes and morphs. */
export function blendable(base: BufferGeometry, source: BufferGeometry): boolean {
  const owned = ['position', 'normal'] as const;
  for (const name of owned) {
    const a = base.getAttribute(name) as Attribute | undefined;
    const b = source.getAttribute(name) as Attribute | undefined;
    if (!a !== !b || (a && b && !compatible(a, b))) return false;
  }
  for (const name of owned) {
    const a = base.morphAttributes[name] ?? [];
    const b = source.morphAttributes[name] ?? [];
    if (a.length !== b.length) return false;
    if (a.some((target, k) => !compatible(target as Attribute, b[k] as Attribute))) return false;
  }
  return sameDna(base, source);
}

/** One blend step done; the sliced runner may yield to the page here. */
type Steps<T> = Generator<void, T, void>;

/**
 * A geometry with the blended positions, normals and morph deltas, sharing
 * everything else (index, UVs, skin, DNA indices) with the base. The base,
 * the loader's cached geometry, is never written. Yields after each attribute.
 */
function* blendGeometrySteps(
  base: BufferGeometry,
  sources: readonly BufferGeometry[],
  weights: readonly number[],
): Steps<BufferGeometry> {
  const out = new BufferGeometry();
  out.setIndex(base.index);
  for (const [name, attribute] of Object.entries(base.attributes))
    out.setAttribute(name, attribute);
  const position = base.getAttribute('position') as Attribute;
  out.setAttribute(
    'position',
    blendAttribute(
      position,
      sources.map((s) => s.getAttribute('position') as Attribute),
      weights,
    ),
  );
  yield;
  const normal = base.getAttribute('normal') as Attribute | undefined;
  if (normal) {
    const blended = blendAttribute(
      normal,
      sources.map((s) => s.getAttribute('normal') as Attribute),
      weights,
    );
    // Never the loader's own attribute here: normals are not all zero.
    if (blended !== normal) renormalize(blended);
    out.setAttribute('normal', blended);
    yield;
  }
  for (const name of Object.keys(base.morphAttributes) as (keyof typeof base.morphAttributes)[]) {
    const targets: Attribute[] = [];
    for (const [k, target] of (base.morphAttributes[name] ?? []).entries()) {
      targets.push(
        blendAttribute(
          target,
          sources.map((s) => s.morphAttributes[name]![k]!),
          weights,
        ),
      );
      yield;
    }
    out.morphAttributes[name] = targets;
  }
  out.morphTargetsRelative = base.morphTargetsRelative;
  for (const group of base.groups) out.addGroup(group.start, group.count, group.materialIndex);
  out.name = base.name;
  out.userData = base.userData;
  // The heads' own bounds (the loader's, morphs included) merged: computing
  // them walks every morph target of every vertex, the costliest part.
  for (const geometry of [base, ...sources]) {
    if (geometry.boundingBox) {
      if (out.boundingBox) out.boundingBox.union(geometry.boundingBox);
      else out.boundingBox = geometry.boundingBox.clone();
    }
    if (geometry.boundingSphere) {
      if (out.boundingSphere) out.boundingSphere.union(geometry.boundingSphere);
      else out.boundingSphere = geometry.boundingSphere.clone();
    }
  }
  return out;
}

/** blendGeometrySteps run to the end at once. */
export function blendGeometry(
  base: BufferGeometry,
  sources: readonly BufferGeometry[],
  weights: readonly number[],
): BufferGeometry {
  return runSync(blendGeometrySteps(base, sources, weights));
}

function runSync<T>(steps: Steps<T>): T {
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

/** Runs the steps a few milliseconds at a time, yielding to the page in between. */
async function runSliced<T>(steps: Steps<T>, budgetMs: number): Promise<T> {
  for (;;) {
    const until = performance.now() + budgetMs;
    for (;;) {
      const step = steps.next();
      if (step.done) return step.value;
      if (performance.now() >= until) break;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

function materialName(mesh: SkinnedMesh): string {
  const material = mesh.material as Material | Material[];
  return Array.isArray(material) ? (material[0]?.name ?? '') : material.name;
}

/** A head blend worked out on the loaded GLBs, ready to put on any clone of the worn head. */
export interface PreparedBlend {
  /** Blended geometry per primitive, by material name. */
  geometries: Map<string, BufferGeometry>;
  /** Blended inverse binds of the head skin, in its joint order (null: left as they are). */
  inverses: Matrix4[] | null;
  /** Blended local positions of the head's bones, by name. */
  bones: Map<string, Vector3>;
}

/**
 * Inverse binds lerped element-wise: the heads' rest rotations agree, so this
 * lerps their translations.
 */
function blendInverses(
  base: readonly Matrix4[],
  sources: readonly (readonly Matrix4[])[],
  weights: readonly number[],
): Matrix4[] {
  return base.map((inverse, j) => {
    const out = inverse.clone();
    for (let k = 0; k < 16; k += 1) {
      let value = inverse.elements[k]!;
      for (let s = 0; s < sources.length; s += 1) {
        value += weights[s]! * (sources[s]![j]!.elements[k]! - inverse.elements[k]!);
      }
      out.elements[k] = value;
    }
    return out;
  });
}

function* prepareSteps(
  head: Object3D,
  sources: readonly FaceBlendSource[],
): Steps<PreparedBlend | null> {
  const normalized = blendWeights(sources.map((s) => s.weight));
  const live = sources
    .map((source, i) => ({ source, weight: normalized[i]! }))
    .filter(({ weight }) => weight > 0);
  if (live.length === 0) return null;
  const weights = live.map(({ weight }) => weight);
  const sourceMeshes = live.map(({ source }) => collectSkinnedMeshes(source.root));

  const geometries = new Map<string, BufferGeometry>();
  let skeleton: Skeleton | null = null;
  let sourceSkeletons: Skeleton[] = [];
  for (const mesh of collectSkinnedMeshes(head)) {
    const name = materialName(mesh);
    const matches = sourceMeshes.map((list) => list.find((m) => materialName(m) === name));
    if (matches.some((m) => !m || !blendable(mesh.geometry, m.geometry))) {
      console.warn(`[mh] face blend skipped the ${name} primitive: layouts differ`);
      continue;
    }
    geometries.set(
      name,
      yield* blendGeometrySteps(
        mesh.geometry,
        matches.map((m) => m!.geometry),
        weights,
      ),
    );
    if (!skeleton) {
      skeleton = mesh.skeleton;
      sourceSkeletons = matches.map((m) => m!.skeleton);
    }
  }
  if (geometries.size === 0) return null;

  const joints = skeleton?.boneInverses.length ?? 0;
  const inverses =
    skeleton && sourceSkeletons.every((s) => s.boneInverses.length === joints)
      ? blendInverses(
          skeleton.boneInverses,
          sourceSkeletons.map((s) => s.boneInverses),
          weights,
        )
      : null;
  const sourceBones = live.map(({ source }) => collectBones(source.root));
  const bones = new Map<string, Vector3>();
  for (const [name, bone] of collectBones(head)) {
    const others = sourceBones.map((list) => list.get(name));
    if (others.some((other) => !other)) continue;
    const position = bone.position.clone();
    others.forEach((other, s) =>
      position.addScaledVector(other!.position.clone().sub(bone.position), weights[s]!),
    );
    bones.set(name, position);
  }
  return { geometries, inverses, bones };
}

/**
 * Works out a blend of the worn head's loaded GLB scene (read, never
 * written) towards the sources, at once. Null when nothing is blended: no
 * positive weight, or no primitive with a matching layout.
 */
export function prepareFaceBlendNow(
  head: Object3D,
  sources: readonly FaceBlendSource[],
): PreparedBlend | null {
  return runSync(prepareSteps(head, sources));
}

/**
 * prepareFaceBlendNow a few milliseconds at a time: a blend is ~14 M
 * components per source and would freeze the stage for a few hundred ms.
 */
export function prepareFaceBlend(
  head: Object3D,
  sources: readonly FaceBlendSource[],
  budgetMs = 6,
): Promise<PreparedBlend | null> {
  return runSliced(prepareSteps(head, sources), budgetMs);
}

/**
 * Puts a prepared blend on an assembled clone of the worn head (after
 * attachHead, before bindNeckSeam): its primitives' geometries, the skin's
 * inverse binds and the positions of `ownBones`, the bones the head brought
 * (face-only joints). The body's shared bones are never moved.
 */
export function applyFaceBlend(
  meshes: readonly SkinnedMesh[],
  ownBones: ReadonlySet<Bone>,
  prepared: PreparedBlend,
): void {
  const skeletons = new Set<Skeleton>();
  for (const mesh of meshes) {
    const geometry = prepared.geometries.get(materialName(mesh));
    if (geometry) mesh.geometry = geometry;
    skeletons.add(mesh.skeleton);
  }
  const { inverses } = prepared;
  if (inverses) {
    for (const skeleton of skeletons) {
      if (skeleton.boneInverses.length !== inverses.length) continue;
      skeleton.boneInverses.forEach((inverse, j) => inverse.copy(inverses[j]!));
    }
  }
  for (const bone of ownBones) {
    const position = prepared.bones.get(bone.name);
    if (position) bone.position.copy(position);
  }
}
