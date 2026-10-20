/**
 * Pure numeric helpers for fitting accessories to measured surfaces. No three
 * imports: everything works on plain arrays so it can be unit-tested with
 * synthetic shapes. Points are xyz (or xy) interleaved.
 */

export type Vec3 = [number, number, number];

// ---------------------------------------------------------------------------
// Principal axes

/** Eigen decomposition of a symmetric 3x3 matrix (row-major), Jacobi sweeps. */
export function eigenSymmetric3(m: readonly number[]): {
  values: Vec3;
  vectors: [Vec3, Vec3, Vec3];
} {
  const a = [
    [m[0], m[1], m[2]],
    [m[3], m[4], m[5]],
    [m[6], m[7], m[8]],
  ];
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 32; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-14) break;
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      if (Math.abs(a[p][q]) < 1e-18) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p];
        const akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k];
        const aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p];
        const vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq;
        v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]);
  const values = order.map((i) => a[i][i]) as Vec3;
  const vectors = order.map((i) => [v[0][i], v[1][i], v[2][i]] as Vec3) as [Vec3, Vec3, Vec3];
  return { values, vectors };
}

export interface PrincipalAxes {
  mean: Vec3;
  /** Unit axes sorted by decreasing variance. */
  axes: [Vec3, Vec3, Vec3];
  variances: Vec3;
}

/** Principal component analysis of xyz-interleaved points. */
export function principalAxes(points: ArrayLike<number>): PrincipalAxes {
  const n = Math.floor(points.length / 3);
  const mean: Vec3 = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    mean[0] += points[i * 3];
    mean[1] += points[i * 3 + 1];
    mean[2] += points[i * 3 + 2];
  }
  if (n > 0) for (let k = 0; k < 3; k++) mean[k] /= n;
  const c = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const d = [points[i * 3] - mean[0], points[i * 3 + 1] - mean[1], points[i * 3 + 2] - mean[2]];
    for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) c[r * 3 + s] += d[r] * d[s];
  }
  if (n > 0) for (let k = 0; k < 9; k++) c[k] /= n;
  const { values, vectors } = eigenSymmetric3(c);
  return { mean, axes: vectors, variances: values };
}

// ---------------------------------------------------------------------------
// Closed 2D rings (cross-sections of necks and wrists)

/** Convex hull of xy-interleaved points (Andrew's monotone chain), counter-clockwise. */
export function convexHull2(points: ArrayLike<number>): number[] {
  const n = Math.floor(points.length / 2);
  const idx = Array.from({ length: n }, (_, i) => i).sort(
    (i, j) => points[i * 2] - points[j * 2] || points[i * 2 + 1] - points[j * 2 + 1],
  );
  if (n < 3) return idx.flatMap((i) => [points[i * 2], points[i * 2 + 1]]);
  const cross = (o: number, a: number, b: number) =>
    (points[a * 2] - points[o * 2]) * (points[b * 2 + 1] - points[o * 2 + 1]) -
    (points[a * 2 + 1] - points[o * 2 + 1]) * (points[b * 2] - points[o * 2]);
  const lower: number[] = [];
  for (const i of idx) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], i) <= 0)
      lower.pop();
    lower.push(i);
  }
  const upper: number[] = [];
  for (let k = idx.length - 1; k >= 0; k--) {
    const i = idx[k];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], i) <= 0)
      upper.pop();
    upper.push(i);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  return hull.flatMap((i) => [points[i * 2], points[i * 2 + 1]]);
}

/** Resample a closed xy polyline to `count` points evenly spaced along its length. */
export function resampleClosed(poly: readonly number[], count: number): number[] {
  const n = poly.length / 2;
  const cumulative = [0];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    cumulative.push(
      cumulative[i] + Math.hypot(poly[j * 2] - poly[i * 2], poly[j * 2 + 1] - poly[i * 2 + 1]),
    );
  }
  const total = cumulative[n];
  const out: number[] = [];
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const s = (k / count) * total;
    while (seg < n - 1 && cumulative[seg + 1] < s) seg++;
    const span = cumulative[seg + 1] - cumulative[seg] || 1;
    const t = (s - cumulative[seg]) / span;
    const j = (seg + 1) % n;
    out.push(
      poly[seg * 2] + (poly[j * 2] - poly[seg * 2]) * t,
      poly[seg * 2 + 1] + (poly[j * 2 + 1] - poly[seg * 2 + 1]) * t,
    );
  }
  return out;
}

/** Length of a closed xy polyline. */
export function closedLength(poly: readonly number[]): number {
  const n = poly.length / 2;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    total += Math.hypot(poly[j * 2] - poly[i * 2], poly[j * 2 + 1] - poly[i * 2 + 1]);
  }
  return total;
}

/** Signed area (positive for counter-clockwise) of a closed xy polyline. */
export function signedArea(poly: readonly number[]): number {
  const n = poly.length / 2;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += poly[i * 2] * poly[j * 2 + 1] - poly[j * 2] * poly[i * 2 + 1];
  }
  return area / 2;
}

/** Move every vertex of a closed counter-clockwise polyline outward by `distance`. */
export function offsetClosed(poly: readonly number[], distance: number): number[] {
  const n = poly.length / 2;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = (i + n - 1) % n;
    const q = (i + 1) % n;
    const tx = poly[q * 2] - poly[p * 2];
    const ty = poly[q * 2 + 1] - poly[p * 2 + 1];
    const length = Math.hypot(tx, ty) || 1;
    // Outward normal of a CCW loop is the tangent rotated clockwise.
    out.push(poly[i * 2] + (ty / length) * distance, poly[i * 2 + 1] - (tx / length) * distance);
  }
  return out;
}

/** Closed-loop moving average (3 taps per pass). */
export function smoothClosed(poly: readonly number[], passes: number, dims = 2): number[] {
  let current = [...poly];
  const n = poly.length / dims;
  for (let pass = 0; pass < passes; pass++) {
    const next = new Array<number>(current.length);
    for (let i = 0; i < n; i++) {
      const p = (i + n - 1) % n;
      const q = (i + 1) % n;
      for (let k = 0; k < dims; k++) {
        next[i * dims + k] =
          0.25 * current[p * dims + k] + 0.5 * current[i * dims + k] + 0.25 * current[q * dims + k];
      }
    }
    current = next;
  }
  return current;
}

/**
 * Smallest convex band around a cross-section: hull, even resampling, outward
 * offset by `clearance`, light smoothing. Returns a CCW xy loop.
 */
export function bandRing(points: ArrayLike<number>, clearance: number, count = 64): number[] {
  const hull = convexHull2(points);
  if (hull.length < 6) return [];
  const even = resampleClosed(hull, count);
  return smoothClosed(offsetClosed(even, clearance), 2);
}

// ---------------------------------------------------------------------------
// Rays

export interface RayHit {
  t: number;
  triangle: number;
  /** Barycentric weights of vertices b and c (a = 1 - u - v). */
  u: number;
  v: number;
}

/** Möller-Trumbore ray/triangle test against triangle `tri` of an indexed soup. */
export function rayTriangle(
  positions: ArrayLike<number>,
  index: ArrayLike<number>,
  tri: number,
  origin: Vec3,
  dir: Vec3,
  out: RayHit,
): boolean {
  const a = index[tri * 3] * 3;
  const b = index[tri * 3 + 1] * 3;
  const c = index[tri * 3 + 2] * 3;
  const e1x = positions[b] - positions[a];
  const e1y = positions[b + 1] - positions[a + 1];
  const e1z = positions[b + 2] - positions[a + 2];
  const e2x = positions[c] - positions[a];
  const e2y = positions[c + 1] - positions[a + 1];
  const e2z = positions[c + 2] - positions[a + 2];
  const px = dir[1] * e2z - dir[2] * e2y;
  const py = dir[2] * e2x - dir[0] * e2z;
  const pz = dir[0] * e2y - dir[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return false;
  const inv = 1 / det;
  const tx = origin[0] - positions[a];
  const ty = origin[1] - positions[a + 1];
  const tz = origin[2] - positions[a + 2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return false;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dir[0] * qx + dir[1] * qy + dir[2] * qz) * inv;
  if (v < 0 || u + v > 1) return false;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  if (t <= 0) return false;
  out.t = t;
  out.triangle = tri;
  out.u = u;
  out.v = v;
  return true;
}

/** All hits of a ray against an indexed triangle soup, nearest first. */
export function raycastSoup(
  positions: ArrayLike<number>,
  index: ArrayLike<number>,
  origin: Vec3,
  dir: Vec3,
  maxDistance = Infinity,
): RayHit[] {
  const hits: RayHit[] = [];
  const hit: RayHit = { t: 0, triangle: 0, u: 0, v: 0 };
  const triangles = Math.floor(index.length / 3);
  for (let tri = 0; tri < triangles; tri++) {
    if (rayTriangle(positions, index, tri, origin, dir, hit) && hit.t <= maxDistance)
      hits.push({ ...hit });
  }
  return hits.sort((p, q) => p.t - q.t);
}

// ---------------------------------------------------------------------------
// Radial height map: the outer surface around a vertical axis, r(theta, y)

/**
 * The outer hull of a body region seen from a vertical axis. Coordinates are
 * axis-local: y up, theta = atan2(x, z) (0 faces forward, +pi/2 is the
 * character's left), r = horizontal distance from the axis.
 */
export interface RadialMap {
  thetaBins: number;
  yBins: number;
  y0: number;
  dy: number;
  /** Outer radius per bin, thetaBins x yBins (theta-major rows per y); 0 = empty. */
  r: Float32Array;
}

export function createRadialMap(thetaBins: number, y0: number, y1: number, dy: number): RadialMap {
  const yBins = Math.max(2, Math.ceil((y1 - y0) / dy) + 1);
  return { thetaBins, yBins, y0, dy, r: new Float32Array(thetaBins * yBins) };
}

function thetaBin(map: RadialMap, theta: number): number {
  const t = ((theta / (2 * Math.PI)) % 1) + 1;
  return Math.floor((t % 1) * map.thetaBins) % map.thetaBins;
}

/** Record one surface point (axis-local xyz) into the map. */
export function splatPoint(map: RadialMap, x: number, y: number, z: number): void {
  const j = Math.round((y - map.y0) / map.dy);
  if (j < 0 || j >= map.yBins) return;
  const i = thetaBin(map, Math.atan2(x, z));
  const r = Math.hypot(x, z);
  const k = j * map.thetaBins + i;
  if (r > map.r[k]) map.r[k] = r;
}

/** Record a triangle by sampling it densely enough for the map's resolution. */
export function splatTriangle(map: RadialMap, a: Vec3, b: Vec3, c: Vec3, step: number): void {
  const edge = Math.max(
    Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]),
    Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]),
    Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]),
  );
  const n = Math.min(48, Math.max(1, Math.ceil(edge / step)));
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n - i; j++) {
      const u = i / n;
      const v = j / n;
      const w = 1 - u - v;
      splatPoint(
        map,
        a[0] * w + b[0] * u + c[0] * v,
        a[1] * w + b[1] * u + c[1] * v,
        a[2] * w + b[2] * u + c[2] * v,
      );
    }
  }
}

/** Fill empty bins of each row by circular interpolation between filled ones. */
export function fillRadialMap(map: RadialMap): void {
  const { thetaBins: n, yBins, r } = map;
  for (let j = 0; j < yBins; j++) {
    const row = j * n;
    const filled: number[] = [];
    for (let i = 0; i < n; i++) if (r[row + i] > 0) filled.push(i);
    if (filled.length === 0 || filled.length === n) continue;
    for (let f = 0; f < filled.length; f++) {
      const from = filled[f];
      const to = filled[(f + 1) % filled.length];
      const gap = (to - from + n) % n || n;
      for (let g = 1; g < gap; g++) {
        const t = g / gap;
        r[row + ((from + g) % n)] = r[row + from] * (1 - t) + r[row + to] * t;
      }
    }
  }
}

/** Interpolated outer radius at (theta, y); 0 outside the mapped rows. */
export function radialAt(map: RadialMap, theta: number, y: number): number {
  const fy = (y - map.y0) / map.dy;
  if (fy < 0 || fy > map.yBins - 1) return 0;
  const j0 = Math.floor(fy);
  const j1 = Math.min(map.yBins - 1, j0 + 1);
  const ty = fy - j0;
  const ft = (((theta / (2 * Math.PI)) % 1) + 1) % 1;
  const fi = ft * map.thetaBins - 0.5;
  const i0 = (Math.floor(fi) + map.thetaBins) % map.thetaBins;
  const i1 = (i0 + 1) % map.thetaBins;
  const tt = fi - Math.floor(fi);
  const n = map.thetaBins;
  const r00 = map.r[j0 * n + i0];
  const r01 = map.r[j0 * n + i1];
  const r10 = map.r[j1 * n + i0];
  const r11 = map.r[j1 * n + i1];
  return (r00 * (1 - tt) + r01 * tt) * (1 - ty) + (r10 * (1 - tt) + r11 * tt) * ty;
}

export interface DrapeOptions {
  /** Total loop length (metres). */
  length: number;
  /** Simulation nodes around the loop. */
  nodes: number;
  /** Height (axis-local y) where the loop starts, above its resting place. */
  startY: number;
  /** Distance kept between the chain's centre line and the surface. */
  clearance: number;
  /** Mass of node 0 relative to the chain nodes (a pendant); 1 = plain chain. */
  pendantMass?: number;
  /** Direction (theta) that node 0 starts facing; 0 = front. */
  frontTheta?: number;
  steps?: number;
}

/**
 * Hang a closed chain around the mapped body under gravity: Verlet
 * integration, inextensible (but slack-able) links, mass-weighted so a
 * pendant drags the front into a V, and collision against the radial map.
 * Returns axis-local xyz per node, node 0 at the front.
 */
export function drapeLoop(map: RadialMap, options: DrapeOptions): Float32Array {
  const { length, nodes: n, startY, clearance } = options;
  const steps = options.steps ?? 900;
  const front = options.frontTheta ?? 0;
  const segment = length / n;
  const radius = length / (2 * Math.PI);
  const p = new Float32Array(n * 3);
  const prev = new Float32Array(n * 3);
  const invMass = new Float32Array(n).fill(1);
  if ((options.pendantMass ?? 1) > 1) invMass[0] = 1 / (options.pendantMass ?? 1);

  for (let i = 0; i < n; i++) {
    const theta = front + (i / n) * Math.PI * 2;
    p[i * 3] = Math.sin(theta) * radius;
    p[i * 3 + 1] = startY;
    p[i * 3 + 2] = Math.cos(theta) * radius;
  }
  prev.set(p);

  const dt = 1 / 240;
  const gravity = 9.81 * dt * dt;
  const yMax = map.y0 + (map.yBins - 1) * map.dy;
  const surfaceAt = (theta: number, y: number) =>
    radialAt(map, theta, Math.min(yMax, Math.max(map.y0, y)));
  const dTheta = (Math.PI * 2) / map.thetaBins;
  // Push a penetrating node out along the surface normal, so slopes carry
  // the chain (a purely radial push would let it slide off the shoulders).
  const collide = (i: number) => {
    const x = p[i * 3];
    const y = p[i * 3 + 1];
    const z = p[i * 3 + 2];
    const r = Math.hypot(x, z);
    const theta = Math.atan2(x, z);
    const surface = radialAt(map, theta, y);
    if (surface <= 0 || r < 1e-9 || r >= surface + clearance) return;
    const dRdy = (surfaceAt(theta, y + map.dy) - surfaceAt(theta, y - map.dy)) / (2 * map.dy);
    const dRdTheta = (surfaceAt(theta + dTheta, y) - surfaceAt(theta - dTheta, y)) / (2 * dTheta);
    // Outward normal of r = R(theta, y): r_hat - (R_theta / r) theta_hat - R_y y_hat.
    const sin = Math.sin(theta);
    const cos = Math.cos(theta);
    const k = dRdTheta / r;
    const nx = sin - k * cos;
    const ny = -dRdy;
    const nz = cos + k * sin;
    const length = Math.hypot(nx, ny, nz);
    // Distance to the offset surface along the normal (planar approximation).
    const depth = (surface + clearance - r) / length;
    p[i * 3] += (nx / length) * depth;
    p[i * 3 + 1] += (ny / length) * depth;
    p[i * 3 + 2] += (nz / length) * depth;
  };

  for (let step = 0; step < steps; step++) {
    const damping = step < steps * 0.7 ? 0.985 : 0.9;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) {
        const c = p[i * 3 + k];
        const v = (c - prev[i * 3 + k]) * damping;
        prev[i * 3 + k] = c;
        p[i * 3 + k] = c + v - (k === 1 ? gravity : 0);
      }
    }
    for (let pass = 0; pass < 12; pass++) {
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const dx = p[j * 3] - p[i * 3];
        const dy = p[j * 3 + 1] - p[i * 3 + 1];
        const dz = p[j * 3 + 2] - p[i * 3 + 2];
        const d = Math.hypot(dx, dy, dz);
        if (d <= segment || d < 1e-12) continue;
        const wi = invMass[i];
        const wj = invMass[j];
        const corr = (d - segment) / d / (wi + wj);
        p[i * 3] += dx * corr * wi;
        p[i * 3 + 1] += dy * corr * wi;
        p[i * 3 + 2] += dz * corr * wi;
        p[j * 3] -= dx * corr * wj;
        p[j * 3 + 1] -= dy * corr * wj;
        p[j * 3 + 2] -= dz * corr * wj;
      }
      for (let i = 0; i < n; i++) collide(i);
    }
  }
  return p;
}

// ---------------------------------------------------------------------------
// Open/closed 3D polylines

/** Length of an xyz polyline. */
export function polylineLength(points: ArrayLike<number>, closed: boolean): number {
  const n = Math.floor(points.length / 3);
  let total = 0;
  for (let i = 0; i < n - (closed ? 0 : 1); i++) {
    const j = (i + 1) % n;
    total += Math.hypot(
      points[j * 3] - points[i * 3],
      points[j * 3 + 1] - points[i * 3 + 1],
      points[j * 3 + 2] - points[i * 3 + 2],
    );
  }
  return total;
}

/** Point and unit tangent at arc length `s` along an xyz polyline. */
export function pointAtLength(
  points: ArrayLike<number>,
  closed: boolean,
  s: number,
  outPoint: Vec3,
  outTangent: Vec3,
): void {
  const n = Math.floor(points.length / 3);
  const segments = closed ? n : n - 1;
  let remaining = s;
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % n;
    const dx = points[j * 3] - points[i * 3];
    const dy = points[j * 3 + 1] - points[i * 3 + 1];
    const dz = points[j * 3 + 2] - points[i * 3 + 2];
    const d = Math.hypot(dx, dy, dz);
    if (remaining <= d || i === segments - 1) {
      const t = d > 0 ? Math.min(1, remaining / d) : 0;
      outPoint[0] = points[i * 3] + dx * t;
      outPoint[1] = points[i * 3 + 1] + dy * t;
      outPoint[2] = points[i * 3 + 2] + dz * t;
      const inv = d > 0 ? 1 / d : 0;
      outTangent[0] = dx * inv;
      outTangent[1] = dy * inv;
      outTangent[2] = dz * inv;
      return;
    }
    remaining -= d;
  }
}
