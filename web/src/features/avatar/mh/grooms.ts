import {
  BufferAttribute,
  BufferGeometry,
  Skeleton,
  type InterleavedBufferAttribute,
  type SkinnedMesh,
} from 'three';

/**
 * Groom cards (hair, eyebrows, beard, mustache) from the converter: card meshes
 * skinned to spine_04 … head, fitted to one preset head ("fitted_to") and
 * carrying a surface binding so they follow any other face: each vertex is the
 * barycentric blend of three DNA head positions plus an offset in metres
 * (contract: extras.mh.binding in the cards GLB).
 */

type Attribute = BufferAttribute | InterleavedBufferAttribute;

const BIND_POSITIONS = '_bind_positions';
const BIND_WEIGHTS = '_bind_weights';
const BIND_OFFSET = '_bind_offset';
const DNA_POSITION = '_dna_position';
/** Root-to-tip coordinate of each card vertex (0 at the scalp, 1 at the tip). */
export const STRAND_U = 'hairStrandU';

/**
 * Rest position of every DNA position index of a head primitive, packed xyz
 * (NaN where the primitive has no vertex for an index).
 */
export function headPositionTable(head: BufferGeometry): Float32Array | null {
  const dna = head.getAttribute(DNA_POSITION) as Attribute | undefined;
  const position = head.getAttribute('position') as Attribute | undefined;
  if (!dna || !position) return null;
  let max = 0;
  for (let v = 0; v < dna.count; v += 1) max = Math.max(max, Math.round(dna.getX(v)));
  const table = new Float32Array((max + 1) * 3).fill(Number.NaN);
  for (let v = 0; v < dna.count; v += 1) {
    const p = Math.round(dna.getX(v)) * 3;
    if (!Number.isNaN(table[p]!)) continue;
    table[p] = position.getX(v);
    table[p + 1] = position.getY(v);
    table[p + 2] = position.getZ(v);
  }
  return table;
}

/**
 * Card positions on this head: sum(w * head[p]) + offset. Vertices whose
 * binding points at positions the head lacks keep their loaded position.
 * Returns how many vertices could not be refitted.
 */
export function refitPositions(
  cards: BufferGeometry,
  head: Float32Array,
  out: Float32Array,
): number {
  const indices = cards.getAttribute(BIND_POSITIONS) as Attribute | undefined;
  const weights = cards.getAttribute(BIND_WEIGHTS) as Attribute | undefined;
  const offsets = cards.getAttribute(BIND_OFFSET) as Attribute | undefined;
  const position = cards.getAttribute('position') as Attribute;
  let missed = 0;
  for (let v = 0; v < position.count; v += 1) {
    let x = 0;
    let y = 0;
    let z = 0;
    let ok = Boolean(indices && weights && offsets);
    for (let k = 0; ok && k < 3; k += 1) {
      const p = Math.round(indices!.getComponent(v, k)) * 3;
      const w = weights!.getComponent(v, k);
      const hx = head[p];
      if (hx === undefined || Number.isNaN(hx)) {
        ok = false;
        break;
      }
      x += w * hx;
      y += w * head[p + 1]!;
      z += w * head[p + 2]!;
    }
    if (ok) {
      out[v * 3] = x + offsets!.getX(v);
      out[v * 3 + 1] = y + offsets!.getY(v);
      out[v * 3 + 2] = z + offsets!.getZ(v);
    } else {
      missed += 1;
      out[v * 3] = position.getX(v);
      out[v * 3 + 1] = position.getY(v);
      out[v * 3 + 2] = position.getZ(v);
    }
  }
  return missed;
}

/**
 * Root-to-tip coordinate per vertex: cards are the connected pieces of the
 * index buffer, the root is the vertex closest to the skin (smallest binding
 * offset) and the coordinate is the distance from it over the card's length.
 */
export function strandProgress(cards: BufferGeometry): Float32Array {
  const position = cards.getAttribute('position') as Attribute;
  const offsets = cards.getAttribute(BIND_OFFSET) as Attribute | undefined;
  const count = position.count;
  const parent = new Int32Array(count).map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const index = cards.index;
  if (index) {
    for (let t = 0; t < index.count; t += 3) {
      const a = find(index.getX(t));
      for (let k = 1; k < 3; k += 1) {
        const b = find(index.getX(t + k));
        if (a !== b) parent[b] = a;
      }
    }
  }
  const lift = (v: number) =>
    offsets ? Math.hypot(offsets.getX(v), offsets.getY(v), offsets.getZ(v)) : position.getY(v);
  // Root of each card: the vertex nearest the skin.
  const root = new Map<number, number>();
  for (let v = 0; v < count; v += 1) {
    const card = find(v);
    const current = root.get(card);
    if (current === undefined || lift(v) < lift(current)) root.set(card, v);
  }
  const distance = new Float32Array(count);
  const length = new Map<number, number>();
  for (let v = 0; v < count; v += 1) {
    const card = find(v);
    const r = root.get(card)!;
    const d = Math.hypot(
      position.getX(v) - position.getX(r),
      position.getY(v) - position.getY(r),
      position.getZ(v) - position.getZ(r),
    );
    distance[v] = d;
    length.set(card, Math.max(length.get(card) ?? 0, d));
  }
  for (let v = 0; v < count; v += 1) {
    const total = length.get(find(v))!;
    distance[v] = total > 0 ? distance[v]! / total : 0;
  }
  return distance;
}

/**
 * Copy of the cards geometry for one head: its own refitted positions and the
 * strand coordinate; everything else (normals, UVs, skin, morphs) is shared
 * with the cached GLB.
 */
export function fitCards(
  cards: BufferGeometry,
  head: Float32Array | null,
  progress: Float32Array,
): BufferGeometry {
  const copy = new BufferGeometry();
  copy.setIndex(cards.index);
  for (const [name, attribute] of Object.entries(cards.attributes)) {
    if (name !== 'position') copy.setAttribute(name, attribute);
  }
  const positions = new Float32Array((cards.getAttribute('position') as Attribute).count * 3);
  const missed = head ? refitPositions(cards, head, positions) : positions.length / 3;
  if (!head || missed === positions.length / 3) {
    // No binding data or a foreign head: wear the cards as loaded.
    const source = cards.getAttribute('position') as Attribute;
    for (let v = 0; v < source.count; v += 1) {
      positions[v * 3] = source.getX(v);
      positions[v * 3 + 1] = source.getY(v);
      positions[v * 3 + 2] = source.getZ(v);
    }
  }
  copy.setAttribute('position', new BufferAttribute(positions, 3));
  copy.setAttribute(STRAND_U, new BufferAttribute(progress, 1));
  copy.morphAttributes = cards.morphAttributes;
  copy.morphTargetsRelative = cards.morphTargetsRelative;
  copy.computeBoundingSphere();
  copy.name = cards.name;
  return copy;
}

/**
 * Skins the cards with the head's joints and inverse bind matrices (the
 * positions are in the head's bind space), so they follow the head exactly,
 * body sliders included. `joints` are the cards' joint names in skin index
 * order. Throws when the head lacks one of them.
 */
export function bindToHead(cards: SkinnedMesh, joints: readonly string[], head: SkinnedMesh): void {
  const names = head.skeleton.bones.map((bone) => bone.name);
  const bones = joints.map((joint) => {
    const i = names.indexOf(joint);
    if (i < 0) throw new Error(`Groom joint ${joint} is not in the head skeleton`);
    return i;
  });
  cards.bind(
    new Skeleton(
      bones.map((i) => head.skeleton.bones[i]!),
      bones.map((i) => head.skeleton.boneInverses[i]!.clone()),
    ),
    head.bindMatrix,
  );
  cards.frustumCulled = false;
}
