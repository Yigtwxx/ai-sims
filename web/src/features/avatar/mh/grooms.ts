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
 * (contract: extras.mh.binding in the cards GLB). Cards only translate with
 * their root that way, so a long card sinks into a head that is fuller
 * elsewhere along it; every vertex also carries the depth it was designed at
 * under or over the skin (extras.mh.depth), and `keepCardDepth` pushes it back
 * out (twin of `keep_depth` in pipeline/src/asset_pipeline/mh/grooms.py).
 */

type Attribute = BufferAttribute | InterleavedBufferAttribute;

const BIND_POSITIONS = '_bind_positions';
const BIND_WEIGHTS = '_bind_weights';
const BIND_OFFSET = '_bind_offset';
/** VEC2: the nearest DNA position on the authoring head, the depth in steps. */
const SURFACE_DEPTH = '_surface_depth';
/** Vertex minus the index of the vertex it follows from root to tip; 0 for roots. */
const SURFACE_PARENT = '_surface_parent';
const DNA_POSITION = '_dna_position';
/** Root-to-tip coordinate of each card vertex (0 at the scalp, 1 at the tip). */
export const STRAND_U = 'hairStrandU';

// Designed depth, the converter's constants (grooms.py).
/** Metres per `_surface_depth` step. */
const DEPTH_UNIT = 1e-5;
/** `_surface_depth` steps of a vertex with no depth of its own: it follows its parent. */
const UNBOUND_DEPTH = -32768;
/** `_surface_depth` steps of a copy: by design at its parent's position (a seam). */
const COPY_DEPTH = 32767;
/** Pushes fade out from this far out of the skin (metres)… */
const DEPTH_FULL = 0.03;
/** …to nothing here. */
const DEPTH_REACH = 0.05;
/** Sinking this much beyond the design is left alone (metres). */
const DEPTH_SLACK = 0.0005;
/** Rounds of push smoothing along the cards. */
const SMOOTH_STEPS = 4;

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

/** A head's DNA positions and their outward normals, packed xyz. */
export interface HeadSurface {
  /** `headPositionTable`. */
  positions: Float32Array;
  /** Unit normal per DNA position (zero where no whole triangle touches it); null without an index. */
  normals: Float32Array | null;
  /** Neighbours of every DNA position along the triangle edges (ascending), CSR: */
  neighbourStart: Int32Array;
  /** the neighbours. */
  neighbours: Int32Array;
  /** 1 for DNA positions on an open edge (neck, eyes, mouth). */
  boundary: Uint8Array;
}

/**
 * The DNA position graph of a head primitive: neighbours along its triangle
 * edges and the positions on an open edge (an edge of one triangle only).
 */
export function headGraph(
  head: BufferGeometry,
  rows: number,
): Pick<HeadSurface, 'neighbourStart' | 'neighbours' | 'boundary'> {
  const index = head.index;
  const dna = head.getAttribute(DNA_POSITION) as Attribute | undefined;
  const uses = new Map<number, number>();
  if (index && dna) {
    for (let t = 0; t + 2 < index.count; t += 3) {
      for (let k = 0; k < 3; k += 1) {
        const a = Math.round(dna.getX(index.getX(t + k)));
        const b = Math.round(dna.getX(index.getX(t + ((k + 1) % 3))));
        if (a === b) continue;
        const key = Math.min(a, b) * rows + Math.max(a, b);
        uses.set(key, (uses.get(key) ?? 0) + 1);
      }
    }
  }
  const boundary = new Uint8Array(rows);
  const neighbourStart = new Int32Array(rows + 1);
  for (const [key, count] of uses) {
    const a = Math.floor(key / rows);
    const b = key % rows;
    neighbourStart[a + 1] += 1;
    neighbourStart[b + 1] += 1;
    if (count === 1) boundary[a] = boundary[b] = 1;
  }
  for (let p = 0; p < rows; p += 1) neighbourStart[p + 1] += neighbourStart[p]!;
  const neighbours = new Int32Array(neighbourStart[rows]!);
  const fill = neighbourStart.slice(0, rows);
  for (const key of uses.keys()) {
    const a = Math.floor(key / rows);
    const b = key % rows;
    neighbours[fill[a]!++] = b;
    neighbours[fill[b]!++] = a;
  }
  for (let p = 0; p < rows; p += 1) {
    neighbours.subarray(neighbourStart[p]!, neighbourStart[p + 1]!).sort();
  }
  return { neighbourStart, neighbours, boundary };
}

/**
 * Area-weighted unit normals of the head's DNA positions from its triangles,
 * turned outward (away from the mean position on the whole). Triangles that
 * touch a missing position are left out.
 */
export function headNormals(head: BufferGeometry, table: Float32Array): Float32Array | null {
  const index = head.index;
  const dna = head.getAttribute(DNA_POSITION) as Attribute | undefined;
  if (!index || !dna) return null;
  const sum = new Float64Array(table.length);
  const corner = [0, 0, 0];
  for (let t = 0; t + 2 < index.count; t += 3) {
    let whole = true;
    for (let k = 0; k < 3; k += 1) {
      const p = Math.round(dna.getX(index.getX(t + k))) * 3;
      if (Number.isNaN(table[p] ?? Number.NaN)) whole = false;
      corner[k] = p;
    }
    if (!whole) continue;
    const [a, b, c] = corner as [number, number, number];
    const ux = table[b]! - table[a]!;
    const uy = table[b + 1]! - table[a + 1]!;
    const uz = table[b + 2]! - table[a + 2]!;
    const vx = table[c]! - table[a]!;
    const vy = table[c + 1]! - table[a + 1]!;
    const vz = table[c + 2]! - table[a + 2]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const p of corner) {
      sum[p] += nx;
      sum[p + 1] += ny;
      sum[p + 2] += nz;
    }
  }
  const normals = new Float32Array(table.length);
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let present = 0;
  for (let p = 0; p < table.length; p += 3) {
    if (Number.isNaN(table[p]!)) continue;
    cx += table[p]!;
    cy += table[p + 1]!;
    cz += table[p + 2]!;
    present += 1;
  }
  if (present === 0) return normals;
  cx /= present;
  cy /= present;
  cz /= present;
  let outward = 0;
  for (let p = 0; p < table.length; p += 3) {
    const length = Math.hypot(sum[p]!, sum[p + 1]!, sum[p + 2]!);
    if (length <= 0) continue;
    normals[p] = sum[p]! / length;
    normals[p + 1] = sum[p + 1]! / length;
    normals[p + 2] = sum[p + 2]! / length;
    if (Number.isNaN(table[p]!)) continue;
    outward +=
      normals[p]! * (table[p]! - cx) +
      normals[p + 1]! * (table[p + 1]! - cy) +
      normals[p + 2]! * (table[p + 2]! - cz);
  }
  if (outward < 0) for (let i = 0; i < normals.length; i += 1) normals[i] = -normals[i]!;
  return normals;
}

/** The head's DNA positions and normals, or null without DNA positions. */
export function headSurface(head: BufferGeometry): HeadSurface | null {
  const positions = headPositionTable(head);
  if (!positions) return null;
  return {
    positions,
    normals: headNormals(head, positions),
    ...headGraph(head, positions.length / 3),
  };
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

/** How the card vertices follow each other from root to tip (per cards GLB). */
export interface CardForest {
  /** The vertex each one follows, -1 for roots. */
  parent: Int32Array;
  /** Every vertex, parents before their children. */
  order: Int32Array;
  /** 1 for a copy: by design at its parent's position (cards split at a seam). */
  copy: Uint8Array;
  /** The vertex a copy sits on (the first ancestor that is no copy); itself otherwise. */
  point: Int32Array;
  /** The cards' edges between points (copies folded into theirs), CSR: */
  edgeStart: Int32Array;
  /** the other end of every edge, with multiplicity. */
  edgeEnd: Int32Array;
}

/**
 * Reads `_surface_parent` and the copies from `_surface_depth`, orders the
 * vertices root to tip and gathers the edges the pushes are smoothed along.
 * Null for cards converted without a designed depth.
 */
export function cardForest(cards: BufferGeometry): CardForest | null {
  const link = cards.getAttribute(SURFACE_PARENT) as Attribute | undefined;
  const depth = cards.getAttribute(SURFACE_DEPTH) as Attribute | undefined;
  if (!link || !depth) return null;
  const count = link.count;
  const parent = new Int32Array(count);
  const copy = new Uint8Array(count);
  for (let v = 0; v < count; v += 1) {
    const delta = Math.round(link.getX(v));
    const p = v - delta;
    parent[v] = delta !== 0 && p >= 0 && p < count ? p : -1;
    copy[v] = parent[v]! >= 0 && depth.getY(v) === COPY_DEPTH ? 1 : 0;
  }
  // Steps from the root; -2 marks a vertex on the current walk up.
  const level = new Int32Array(count).fill(-1);
  const walk: number[] = [];
  for (let v = 0; v < count; v += 1) {
    let u = v;
    while (level[u] === -1 && parent[u]! >= 0) {
      level[u] = -2;
      walk.push(u);
      u = parent[u]!;
    }
    if (level[u] === -2) {
      // A cycle (the converter writes none): cut it here and walk again.
      parent[u] = -1;
      copy[u] = 0;
      for (const w of walk) level[w] = -1;
      walk.length = 0;
      v -= 1;
      continue;
    }
    if (level[u] === -1) level[u] = 0;
    let steps = level[u]!;
    for (let i = walk.length - 1; i >= 0; i -= 1) {
      steps += 1;
      level[walk[i]!] = steps;
    }
    walk.length = 0;
  }
  let deepest = 0;
  for (let v = 0; v < count; v += 1) deepest = Math.max(deepest, level[v]!);
  const slots = new Int32Array(deepest + 2);
  for (let v = 0; v < count; v += 1) slots[level[v]! + 1] += 1;
  for (let l = 1; l < slots.length; l += 1) slots[l] += slots[l - 1]!;
  const order = new Int32Array(count);
  for (let v = 0; v < count; v += 1) order[slots[level[v]!]!++] = v;

  // In root-to-tip order a copy's parent already knows its point.
  const point = new Int32Array(count);
  for (const v of order) point[v] = copy[v] ? point[parent[v]!]! : v;
  const edgeStart = new Int32Array(count + 1);
  const index = cards.index;
  const pairs: number[] = [];
  if (index) {
    for (let t = 0; t + 2 < index.count; t += 3) {
      for (let k = 0; k < 3; k += 1) {
        const a = point[index.getX(t + k)]!;
        const b = point[index.getX(t + ((k + 1) % 3))]!;
        if (a === b) continue;
        pairs.push(a, b);
        edgeStart[a + 1] += 1;
        edgeStart[b + 1] += 1;
      }
    }
  }
  for (let v = 0; v < count; v += 1) edgeStart[v + 1] += edgeStart[v]!;
  const edgeEnd = new Int32Array(edgeStart[count]!);
  const fill = edgeStart.slice(0, count);
  for (let i = 0; i < pairs.length; i += 2) {
    const a = pairs[i]!;
    const b = pairs[i + 1]!;
    edgeEnd[fill[a]!++] = b;
    edgeEnd[fill[b]!++] = a;
  }
  return { parent, order, copy, point, edgeStart, edgeEnd };
}

/**
 * Pushes cards refitted to a head (`positions`, root translation only) back
 * out to the depth they were designed at; never pulls a vertex in.
 *
 * A vertex's depth now is taken at the head vertex nearest to where it is,
 * walked to from the one it was designed over, so a piece the root
 * translation slid along the skin is judged where it is; nearest to an open
 * edge, a vertex keeps no depth of its own.
 *
 * 1. Root to tip, a vertex takes its parent's push and, when it still sits
 *    deeper under (or nearer to) the skin than designed by over DEPTH_SLACK,
 *    moves out along the head normal by the rest (fading out from DEPTH_FULL
 *    to DEPTH_REACH out of the skin), so the card beyond a push follows it. A
 *    copy also moves onto its parent, and the rest of its piece with it
 *    (pieces of a card translate with roots of their own and tear apart).
 * 2. SMOOTH_STEPS rounds of `push = (push + mean of the neighbours') / 2`
 *    along the card edges, so cards bend rather than shear.
 * 3. What the smoothing took off a vertex it still needs, it takes back.
 *
 * Returns how many vertices moved (by over 0.1 mm).
 */
export function keepCardDepth(
  cards: BufferGeometry,
  head: HeadSurface,
  forest: CardForest,
  positions: Float32Array,
): number {
  const depth = cards.getAttribute(SURFACE_DEPTH) as Attribute | undefined;
  const { positions: table, normals, neighbourStart, neighbours, boundary } = head;
  const { parent, order, copy, point, edgeStart, edgeEnd } = forest;
  const count = parent.length;
  if (!depth || !normals || positions.length !== count * 3) return 0;

  // The head vertex each card vertex with a depth of its own was last nearest to.
  const under = new Int32Array(count).fill(-1);
  const designed = new Float64Array(count);
  const fade = new Float64Array(count);
  const rows = table.length / 3;
  for (let v = 0; v < count; v += 1) {
    const steps = depth.getY(v);
    const p = Math.round(depth.getX(v));
    if (steps === UNBOUND_DEPTH || steps === COPY_DEPTH || p < 0 || p >= rows) continue;
    designed[v] = steps * DEPTH_UNIT;
    fade[v] = Math.min(Math.max((DEPTH_REACH - designed[v]!) / (DEPTH_REACH - DEPTH_FULL), 0), 1);
    if (fade[v]! > 0) under[v] = p;
  }
  const distance = (p: number, x: number, y: number, z: number): number => {
    const dx = x - table[p * 3]!;
    const dy = y - table[p * 3 + 1]!;
    const dz = z - table[p * 3 + 2]!;
    return dx * dx + dy * dy + dz * dz;
  };
  /**
   * How far vertex v, moved by (x, y, z), still is to go out along the normal
   * of the head vertex nearest to it (then `under[v]`); 0 when it needs not.
   */
  const need = (v: number, x: number, y: number, z: number): number => {
    let u = under[v]!;
    if (u < 0) return 0;
    const px = positions[v * 3]! + x;
    const py = positions[v * 3 + 1]! + y;
    const pz = positions[v * 3 + 2]! + z;
    let best = distance(u, px, py, pz);
    for (let step = 0; step < 64; step += 1) {
      let next = u;
      let nearer = best;
      for (let e = neighbourStart[u]!; e < neighbourStart[u + 1]!; e += 1) {
        const w = neighbours[e]!;
        const d = distance(w, px, py, pz);
        if (d < nearer) {
          nearer = d;
          next = w;
        }
      }
      if (next === u) break;
      u = next;
      best = nearer;
    }
    under[v] = u;
    const n = u * 3;
    if (boundary[u] || Math.hypot(normals[n]!, normals[n + 1]!, normals[n + 2]!) <= 0.5) return 0;
    const now =
      (px - table[n]!) * normals[n]! +
      (py - table[n + 1]!) * normals[n + 1]! +
      (pz - table[n + 2]!) * normals[n + 2]!;
    if (Number.isNaN(now)) return 0;
    return Math.max(designed[v]! - now - DEPTH_SLACK, 0) * fade[v]!;
  };
  const normal = (v: number, c: number): number =>
    under[v]! < 0 ? 0 : normals[under[v]! * 3 + c]!;

  const join = new Float64Array(count * 3);
  let push = new Float64Array(count * 3);
  for (const v of order) {
    const p = parent[v]!;
    if (p >= 0) {
      for (let c = 0; c < 3; c += 1) {
        join[v * 3 + c] = copy[v]
          ? positions[p * 3 + c]! + join[p * 3 + c]! - positions[v * 3 + c]!
          : join[p * 3 + c]!;
        push[v * 3 + c] = push[p * 3 + c]!;
      }
    }
    const k = need(
      v,
      join[v * 3]! + push[v * 3]!,
      join[v * 3 + 1]! + push[v * 3 + 1]!,
      join[v * 3 + 2]! + push[v * 3 + 2]!,
    );
    for (let c = 0; c < 3; c += 1) push[v * 3 + c] = push[v * 3 + c]! + k * normal(v, c);
  }
  let next = new Float64Array(count * 3);
  for (let step = 0; step < SMOOTH_STEPS; step += 1) {
    for (let v = 0; v < count; v += 1) {
      const start = edgeStart[v]!;
      const end = edgeStart[v + 1]!;
      for (let c = 0; c < 3; c += 1) {
        if (end === start) {
          next[v * 3 + c] = push[v * 3 + c]!;
          continue;
        }
        let sum = 0;
        for (let e = start; e < end; e += 1) sum += push[edgeEnd[e]! * 3 + c]!;
        next[v * 3 + c] = 0.5 * push[v * 3 + c]! + (0.5 * sum) / (end - start);
      }
    }
    [push, next] = [next, push];
  }
  const out = new Float64Array(count * 3);
  for (let v = 0; v < count; v += 1) {
    const x = join[v * 3]! + push[v * 3]!;
    const y = join[v * 3 + 1]! + push[v * 3 + 1]!;
    const z = join[v * 3 + 2]! + push[v * 3 + 2]!;
    const k = need(v, x, y, z);
    out[v * 3] = positions[v * 3]! + x + k * normal(v, 0);
    out[v * 3 + 1] = positions[v * 3 + 1]! + y + k * normal(v, 1);
    out[v * 3 + 2] = positions[v * 3 + 2]! + z + k * normal(v, 2);
  }
  let moved = 0;
  for (let v = 0; v < count; v += 1) {
    const from = point[v]! * 3;
    let shift = 0;
    for (let c = 0; c < 3; c += 1) {
      const value = out[from + c]!;
      shift += (value - positions[v * 3 + c]!) ** 2;
      positions[v * 3 + c] = value;
    }
    if (shift > 1e-8) moved += 1;
  }
  return moved;
}

/**
 * Copy of the cards geometry for one head: its own refitted positions (kept
 * at their designed depth when `forest` is given) and the strand coordinate;
 * everything else (normals, UVs, skin, morphs) is shared with the cached GLB.
 */
export function fitCards(
  cards: BufferGeometry,
  head: HeadSurface | null,
  progress: Float32Array,
  forest: CardForest | null = null,
): BufferGeometry {
  const copy = new BufferGeometry();
  copy.setIndex(cards.index);
  for (const [name, attribute] of Object.entries(cards.attributes)) {
    if (name !== 'position') copy.setAttribute(name, attribute);
  }
  const positions = new Float32Array((cards.getAttribute('position') as Attribute).count * 3);
  const missed = head ? refitPositions(cards, head.positions, positions) : positions.length / 3;
  if (head && forest && missed < positions.length / 3) {
    keepCardDepth(cards, head, forest, positions);
  }
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
  // Bounds of the rest cards, before the morphs are attached: with them, three
  // widens the sphere by every face morph of every vertex (most of a second on
  // long hair, on the main thread). The cards are never frustum culled, and
  // the expressions move them by millimetres.
  copy.computeBoundingSphere();
  copy.morphAttributes = cards.morphAttributes;
  copy.morphTargetsRelative = cards.morphTargetsRelative;
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
