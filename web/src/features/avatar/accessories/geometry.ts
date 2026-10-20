import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  ExtrudeGeometry,
  Float32BufferAttribute,
  LatheGeometry,
  Matrix4,
  Quaternion,
  Shape,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Procedural geometry for jewellery. Pieces are authored in metres in a local
 * frame (y up, z out of the piece's face) and placed by the item builders.
 */

export type Profile = readonly (readonly [number, number])[];

/** Closed cross-section: circle. */
export function circleProfile(radius: number, segments: number): Profile {
  return Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * Math.PI * 2;
    return [Math.cos(a) * radius, Math.sin(a) * radius] as const;
  });
}

/** Closed cross-section: rounded rectangle (width along x, height along y). */
export function roundedRectProfile(
  width: number,
  height: number,
  radius: number,
  cornerSegments = 3,
): Profile {
  const r = Math.min(radius, width / 2, height / 2);
  const hx = width / 2 - r;
  const hy = height / 2 - r;
  const corners: [number, number, number][] = [
    [hx, hy, 0],
    [-hx, hy, Math.PI / 2],
    [-hx, -hy, Math.PI],
    [hx, -hy, (Math.PI * 3) / 2],
  ];
  const out: (readonly [number, number])[] = [];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= cornerSegments; i++) {
      const a = start + (i / cornerSegments) * (Math.PI / 2);
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  return out;
}

/** Closed cross-section: half-round "D" (flat side facing -x, dome toward +x). */
export function dProfile(width: number, height: number, segments = 8): Profile {
  const out: (readonly [number, number])[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = -Math.PI / 2 + (i / segments) * Math.PI;
    out.push([Math.cos(a) * width, Math.sin(a) * (height / 2)]);
  }
  // Slightly eased flat inner side so the band's edge catches a highlight.
  out.push([-width * 0.08, height * 0.42], [-width * 0.08, -height * 0.42]);
  return out;
}

export interface SweepOptions {
  /** Centre line. */
  path: readonly Vector3[];
  closed: boolean;
  /** Cross-section (x along `normals`, y along binormal). */
  profile: Profile;
  /**
   * Per-point reference direction for the profile's x axis; it is made
   * perpendicular to the tangent. Default: parallel transport.
   */
  normals?: readonly Vector3[];
  /** Per-point uniform profile scale (tapering). */
  scales?: readonly number[];
  /** Close open ends with flat caps. */
  caps?: boolean;
}

const _t = new Vector3();
const _n = new Vector3();
const _b = new Vector3();
const _q = new Quaternion();

function tangentAt(path: readonly Vector3[], i: number, closed: boolean, target: Vector3): Vector3 {
  const n = path.length;
  const prev = closed ? path[(i + n - 1) % n] : path[Math.max(0, i - 1)];
  const next = closed ? path[(i + 1) % n] : path[Math.min(n - 1, i + 1)];
  return target.subVectors(next, prev).normalize();
}

/** Rotation-minimizing normals along a path, seeded from `seed`. */
export function transportNormals(
  path: readonly Vector3[],
  closed: boolean,
  seed: Vector3,
): Vector3[] {
  const normals: Vector3[] = [];
  const prevT = tangentAt(path, 0, closed, new Vector3());
  const normal = seed.clone().addScaledVector(prevT, -seed.dot(prevT));
  if (normal.lengthSq() < 1e-10) normal.set(1, 0, 0).addScaledVector(prevT, -prevT.x);
  normal.normalize();
  normals.push(normal.clone());
  for (let i = 1; i < path.length; i++) {
    tangentAt(path, i, closed, _t);
    _q.setFromUnitVectors(prevT, _t);
    normal.applyQuaternion(_q).addScaledVector(_t, -normal.dot(_t)).normalize();
    normals.push(normal.clone());
    prevT.copy(_t);
  }
  if (closed && path.length > 2) {
    // Spread the residual twist so the seam closes without a kink.
    tangentAt(path, 0, closed, _t);
    const end = normals[normals.length - 1].clone();
    _q.setFromUnitVectors(prevT, _t);
    end.applyQuaternion(_q);
    const start = normals[0];
    _b.crossVectors(end, start);
    const angle = Math.atan2(_b.dot(_t), end.dot(start));
    for (let i = 0; i < normals.length; i++) {
      tangentAt(path, i, closed, _t);
      _q.setFromAxisAngle(_t, (angle * i) / normals.length);
      normals[i].applyQuaternion(_q);
    }
  }
  return normals;
}

/** Sweep a closed 2D profile along a path; smooth normals, u along the path. */
export function sweep(options: SweepOptions): BufferGeometry {
  const { path, closed, profile } = options;
  const rows = path.length;
  const cols = profile.length;
  const normals = options.normals ?? transportNormals(path, closed, new Vector3(0, 1, 0));
  const positions: number[] = [];
  const uvs: number[] = [];
  let length = 0;
  for (let i = 0; i < rows; i++) {
    if (i > 0) length += path[i].distanceTo(path[i - 1]);
    tangentAt(path, i, closed, _t);
    _n.copy(normals[i]).addScaledVector(_t, -normals[i].dot(_t)).normalize();
    _b.crossVectors(_t, _n);
    const s = options.scales?.[i] ?? 1;
    // One extra column duplicates the first so u/v wrap without a texture seam.
    for (let j = 0; j <= cols; j++) {
      const [px, py] = profile[j % cols];
      positions.push(
        path[i].x + (_n.x * px + _b.x * py) * s,
        path[i].y + (_n.y * px + _b.y * py) * s,
        path[i].z + (_n.z * px + _b.z * py) * s,
      );
      uvs.push(length, j / cols);
    }
  }
  const indices: number[] = [];
  const stride = cols + 1;
  const segments = closed ? rows : rows - 1;
  for (let i = 0; i < segments; i++) {
    const i2 = (i + 1) % rows;
    for (let j = 0; j < cols; j++) {
      const a = i * stride + j;
      const b = i2 * stride + j;
      const c = i2 * stride + j + 1;
      const d = i * stride + j + 1;
      // The profile runs counter-clockwise about the tangent: wind outward.
      indices.push(a, d, b, b, d, c);
    }
  }
  if (!closed && options.caps) {
    for (const [row, flip] of [
      [0, true],
      [rows - 1, false],
    ] as const) {
      const centre = positions.length / 3;
      positions.push(path[row].x, path[row].y, path[row].z);
      uvs.push(0, 0);
      for (let j = 0; j < cols; j++) {
        const a = row * stride + j;
        const b = row * stride + j + 1;
        if (flip) indices.push(centre, b, a);
        else indices.push(centre, a, b);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Round wire along a smooth curve through `points`. */
export function wire(
  points: readonly Vector3[],
  radius: number,
  options: { closed?: boolean; segments?: number; radial?: number; tension?: number } = {},
): BufferGeometry {
  const curve = new CatmullRomCurve3(
    points.map((p) => p.clone()),
    options.closed ?? false,
    'catmullrom',
    options.tension ?? 0.5,
  );
  return new TubeGeometry(
    curve,
    options.segments ?? Math.max(8, points.length * 4),
    radius,
    options.radial ?? 8,
    options.closed ?? false,
  );
}

/** Sample a smooth curve through `points` into `count` evenly spaced points. */
export function smoothPath(points: readonly Vector3[], closed: boolean, count: number): Vector3[] {
  const curve = new CatmullRomCurve3(
    points.map((p) => p.clone()),
    closed,
    'centripetal',
  );
  return curve.getSpacedPoints(closed ? count : count - 1).slice(0, count);
}

/**
 * One oval chain link lying in the xz plane, long axis along z, centred at
 * the origin. `innerLength` is also the pitch between interlocked links.
 */
export function chainLink(
  innerLength: number,
  innerWidth: number,
  wireRadius: number,
  radial = 6,
  arcSegments = 4,
): BufferGeometry {
  const rc = innerWidth / 2 + wireRadius;
  const straight = Math.max(0, innerLength - innerWidth) / 2;
  const path: Vector3[] = [];
  for (const [cz, start] of [
    [straight, 0],
    [-straight, Math.PI],
  ] as const) {
    for (let i = 0; i <= arcSegments; i++) {
      const a = start + (i / arcSegments) * Math.PI;
      path.push(new Vector3(Math.cos(a) * rc, 0, cz + Math.sin(a) * rc));
    }
  }
  const up = path.map(() => new Vector3(0, 1, 0));
  return sweep({ path, closed: true, profile: circleProfile(wireRadius, radial), normals: up });
}

/** Lathe a (radius, height) profile around y. */
export function lathe(
  profile: readonly (readonly [number, number])[],
  segments: number,
): BufferGeometry {
  return new LatheGeometry(
    profile.map(([r, y]) => new Vector2(Math.max(0, r), y)),
    segments,
  );
}

/** Flat-shaded copy: every triangle gets its own vertices and face normal. */
export function faceted(geometry: BufferGeometry): BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  flat.deleteAttribute('normal');
  flat.computeVertexNormals();
  return flat;
}

function polygonGeometry(vertices: number[], triangles: number[]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(triangles);
  return faceted(geometry);
}

/**
 * Brilliant-style faceted stone with its table facing +z: table, crown star
 * and bezel facets, girdle, pavilion mains and culet. `outline` maps an angle
 * to a girdle radius multiplier (1 = round).
 */
export function brilliant(
  diameter: number,
  options: { outline?: (angle: number) => number; elongation?: number; segments?: number } = {},
): BufferGeometry {
  const seg = options.segments ?? 16;
  const half = seg / 2;
  const r = diameter / 2;
  const outline = options.outline ?? (() => 1);
  const stretch = options.elongation ?? 1;
  const crown = diameter * 0.16;
  const girdle = diameter * 0.025;
  const pavilion = diameter * 0.43;
  const v: number[] = [];
  const ring = (count: number, radius: number, z: number, offset: number) => {
    const start = v.length / 3;
    for (let i = 0; i < count; i++) {
      const a = ((i + offset) / count) * Math.PI * 2;
      const k = outline(a) * radius;
      v.push(Math.sin(a) * k, Math.cos(a) * k * stretch, z);
    }
    return start;
  };
  const table = ring(half, r * 0.56, crown, 0);
  const upper = ring(seg, r, girdle / 2, 0);
  const lower = ring(seg, r, -girdle / 2, 0);
  const mid = ring(half, r * 0.42, -pavilion * 0.62, 0.5);
  const culet = v.length / 3;
  v.push(0, 0, -pavilion);
  const tableCentre = v.length / 3;
  v.push(0, 0, crown);
  const t: number[] = [];
  for (let i = 0; i < half; i++) {
    const i1 = (i + 1) % half;
    const g0 = upper + 2 * i;
    const g1 = upper + ((2 * i + 1) % seg);
    const g2 = upper + ((2 * i + 2) % seg);
    t.push(tableCentre, table + i, table + i1);
    t.push(table + i, g0, g1, table + i, g1, table + i1, table + i1, g1, g2);
  }
  for (let i = 0; i < seg; i++) {
    const i1 = (i + 1) % seg;
    t.push(upper + i, lower + i, upper + i1, upper + i1, lower + i, lower + i1);
  }
  for (let i = 0; i < half; i++) {
    const m = mid + i;
    const m1 = mid + ((i + 1) % half);
    const l0 = lower + 2 * i;
    const l1 = lower + ((2 * i + 1) % seg);
    const l2 = lower + ((2 * i + 2) % seg);
    t.push(l0, m, l1, l1, m, l2, l2, m, m1, m, culet, m1);
  }
  // Facets above were wound for +z out of the crown; flip to CCW outward.
  for (let i = 0; i < t.length; i += 3) [t[i + 1], t[i + 2]] = [t[i + 2], t[i + 1]];
  return polygonGeometry(v, t);
}

/** Pear (teardrop) girdle outline: round at angle pi (bottom), pointed at 0 (top). */
export function pearOutline(angle: number): number {
  const c = Math.cos(angle);
  // Narrows smoothly toward the top; ~0.45 at the tip keeps facets well formed.
  return 1 - 0.55 * Math.pow(Math.max(0, c), 1.6);
}

/** Five-pointed star with a ridge down each arm (faceted), face toward +z. */
export function facetedStar(outer: number, inner: number, thickness: number): BufferGeometry {
  const v: number[] = [];
  const points = 10;
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const r = i % 2 === 0 ? outer : inner;
    v.push(Math.sin(a) * r, Math.cos(a) * r, thickness * 0.12);
  }
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const r = i % 2 === 0 ? outer : inner;
    v.push(Math.sin(a) * r, Math.cos(a) * r, -thickness * 0.12);
  }
  const top = v.length / 3;
  v.push(0, 0, thickness / 2);
  const bottom = v.length / 3;
  v.push(0, 0, -thickness / 2);
  const t: number[] = [];
  for (let i = 0; i < points; i++) {
    const i1 = (i + 1) % points;
    t.push(top, i1, i);
    t.push(bottom, points + i, points + i1);
    t.push(i, i1, points + i1, i, points + i1, points + i);
  }
  return polygonGeometry(v, t);
}

/** Rounded heart outline (point at the bottom), height ~1 before scaling. */
export function heartShape(height: number): Shape {
  const s = height;
  const shape = new Shape();
  shape.moveTo(0, -0.5 * s);
  shape.bezierCurveTo(-0.18 * s, -0.32 * s, -0.56 * s, -0.1 * s, -0.5 * s, 0.18 * s);
  shape.bezierCurveTo(-0.45 * s, 0.44 * s, -0.12 * s, 0.52 * s, 0, 0.3 * s);
  shape.bezierCurveTo(0.12 * s, 0.52 * s, 0.45 * s, 0.44 * s, 0.5 * s, 0.18 * s);
  shape.bezierCurveTo(0.56 * s, -0.1 * s, 0.18 * s, -0.32 * s, 0, -0.5 * s);
  return shape;
}

/** Crescent moon outline opening to the right (+x), height `height`. */
export function crescentShape(height: number, thickness = 0.36): Shape {
  const r = height / 2;
  const inner = r * 0.86;
  const offset = r * thickness * 1.25;
  const shape = new Shape();
  // Outer arc (left side) and inner arc, joined at the horns.
  const steps = 28;
  const hornAngle = Math.acos((offset * offset + r * r - inner * inner) / (2 * offset * r));
  for (let i = 0; i <= steps; i++) {
    const a = hornAngle + (i / steps) * (Math.PI * 2 - 2 * hornAngle);
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  for (let i = steps; i >= 0; i--) {
    const outerA = hornAngle + (i / steps) * (Math.PI * 2 - 2 * hornAngle);
    // Matching point on the inner circle centred at (offset, 0).
    const px = Math.cos(outerA) * r - offset;
    const py = Math.sin(outerA) * r;
    const a = Math.atan2(py, px);
    shape.lineTo(offset + Math.cos(a) * inner, Math.sin(a) * inner);
  }
  shape.closePath();
  return shape;
}

/** Puffed, softly bevelled solid from a 2D shape, centred, face toward +z. */
export function bevelledSolid(
  shape: Shape,
  depth: number,
  bevel: number,
  options: { curveSegments?: number; bevelSegments?: number } = {},
): BufferGeometry {
  const geometry = new ExtrudeGeometry(shape, {
    depth: Math.max(1e-5, depth),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.9,
    bevelSegments: options.bevelSegments ?? 4,
    curveSegments: options.curveSegments ?? 18,
  });
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  geometry.translate(
    -(box.min.x + box.max.x) / 2,
    -(box.min.y + box.max.y) / 2,
    -(box.min.z + box.max.z) / 2,
  );
  // ExtrudeGeometry splits normals at the bevel/cap seams; weld them smooth.
  geometry.deleteAttribute('normal');
  const welded = mergeVertices(geometry, 1e-6);
  geometry.dispose();
  welded.computeVertexNormals();
  return welded;
}

const MERGED_ATTRIBUTES = new Set(['position', 'normal', 'uv']);

/** Merge geometries that share a material into one draw (position, normal, uv). */
export function merge(geometries: BufferGeometry[]): BufferGeometry {
  const prepared = geometries.map((g) => {
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (!g.getAttribute('uv')) {
      const count = g.getAttribute('position').count;
      g.setAttribute('uv', new BufferAttribute(new Float32Array(count * 2), 2));
    }
    for (const name of Object.keys(g.attributes)) {
      if (!MERGED_ATTRIBUTES.has(name)) g.deleteAttribute(name);
    }
    g.morphAttributes = {};
    if (!g.index) {
      const count = g.getAttribute('position').count;
      g.setIndex(Array.from({ length: count }, (_, i) => i));
    }
    return g;
  });
  const merged = mergeGeometries(prepared, false);
  for (const g of geometries) g.dispose();
  if (!merged) throw new Error('merge: incompatible geometries');
  return merged;
}

/** Apply a transform built from position, quaternion and uniform scale. */
export function place(
  geometry: BufferGeometry,
  position: Vector3,
  quaternion = new Quaternion(),
  scale = 1,
): BufferGeometry {
  return geometry.applyMatrix4(
    new Matrix4().compose(position, quaternion, new Vector3(scale, scale, scale)),
  );
}

/** Triangle count of a geometry. */
export function triangleCount(geometry: BufferGeometry): number {
  return (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3;
}
