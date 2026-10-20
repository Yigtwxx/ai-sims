/**
 * Hides skin that sits under clothing, the standard fix for "body pokes
 * through the shirt" when garments from a slimmer donor are worn by a broader
 * base. A skin vertex counts as covered when an opaque garment vertex (texture
 * alpha above the cutout) lies inside a short cylinder around the skin
 * normal: close sideways (`lateral`), and anywhere from `inner` below the skin
 * (skin poking out of a tight garment) to `outer` above it (loose garment).
 * The sideways limit keeps skin next to a collar or sleeve edge visible.
 * Triangles whose three vertices are covered are dropped from the index
 * buffer. Cut-out regions of VRoid garment templates (a crop top's missing
 * hem) are not opaque, so they never punch holes into visible skin.
 */

export interface CoverageInput {
  /** World-space skin vertex positions, xyz interleaved. */
  skin: Float32Array;
  /** Unit skin normals matching `skin`, xyz interleaved. */
  normals: Float32Array;
  /** World-space positions of opaque garment vertices, xyz interleaved. */
  garments: Float32Array;
  /** Max sideways distance from the skin normal axis (metres). */
  lateral: number;
  /** Max depth of a garment below the skin surface (metres). */
  inner: number;
  /** Max height of a garment above the skin surface (metres). */
  outer: number;
}

function cellKey(x: number, y: number, z: number): number {
  // Large primes spread neighbouring cells across the hash space.
  return ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0;
}

/** Per skin vertex: 1 when covered by a garment, else 0. */
export function computeCoveredVertices(input: CoverageInput): Uint8Array {
  const { skin, normals, garments, lateral, inner, outer } = input;
  const reach = Math.max(lateral, inner, outer);
  const cell = reach;
  const grid = new Map<number, number[]>();
  for (let i = 0; i < garments.length; i += 3) {
    const key = cellKey(
      Math.floor(garments[i] / cell),
      Math.floor(garments[i + 1] / cell),
      Math.floor(garments[i + 2] / cell),
    );
    const bucket = grid.get(key);
    if (bucket) bucket.push(i);
    else grid.set(key, [i]);
  }

  const covered = new Uint8Array(skin.length / 3);
  const lateral2 = lateral * lateral;
  for (let v = 0; v < covered.length; v++) {
    const x = skin[v * 3];
    const y = skin[v * 3 + 1];
    const z = skin[v * 3 + 2];
    const nx = normals[v * 3];
    const ny = normals[v * 3 + 1];
    const nz = normals[v * 3 + 2];
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const cz = Math.floor(z / cell);
    search: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid.get(cellKey(cx + dx, cy + dy, cz + dz));
          if (!bucket) continue;
          for (const g of bucket) {
            const ex = garments[g] - x;
            const ey = garments[g + 1] - y;
            const ez = garments[g + 2] - z;
            const depth = ex * nx + ey * ny + ez * nz;
            if (depth < -inner || depth > outer) continue;
            const side2 = ex * ex + ey * ey + ez * ez - depth * depth;
            if (side2 <= lateral2) {
              covered[v] = 1;
              break search;
            }
          }
        }
      }
    }
  }
  return covered;
}

/** Area-weighted vertex normals from positions and a triangle index. */
export function computeVertexNormals(
  positions: Float32Array,
  index: ArrayLike<number>,
): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = index[t] * 3;
    const b = index[t + 1] * 3;
    const c = index[t + 2] * 3;
    const abx = positions[b] - positions[a];
    const aby = positions[b + 1] - positions[a + 1];
    const abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a];
    const acy = positions[c + 1] - positions[a + 1];
    const acz = positions[c + 2] - positions[a + 2];
    // Unnormalized cross product: its length weights by triangle area.
    const fx = aby * acz - abz * acy;
    const fy = abz * acx - abx * acz;
    const fz = abx * acy - aby * acx;
    for (const i of [a, b, c]) {
      normals[i] += fx;
      normals[i + 1] += fy;
      normals[i + 2] += fz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= length;
    normals[i + 1] /= length;
    normals[i + 2] /= length;
  }
  return normals;
}

/** Drop triangles whose three vertices are all covered. */
export function filterCoveredTriangles(index: ArrayLike<number>, covered: Uint8Array): Uint32Array {
  const kept: number[] = [];
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = index[t];
    const b = index[t + 1];
    const c = index[t + 2];
    if (covered[a] && covered[b] && covered[c]) continue;
    kept.push(a, b, c);
  }
  return Uint32Array.from(kept);
}
