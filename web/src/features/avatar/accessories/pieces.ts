import {
  BufferGeometry,
  CylinderGeometry,
  Matrix4,
  Quaternion,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';

import { findAccessory } from './catalog';
import {
  bevelledSolid,
  brilliant,
  chainLink,
  circleProfile,
  crescentShape,
  dProfile,
  facetedStar,
  heartShape,
  lathe,
  merge,
  pearOutline,
  place,
  roundedRectProfile,
  smoothPath,
  sweep,
  wire,
} from './geometry';
import { SETTING_STEEL, type JewelleryFinish } from './materials';

/**
 * Procedural jewellery, in metres. Two kinds of piece:
 *  - pinned (earrings, piercings): built in the frame of the skin they sit on,
 *    origin on the skin, x right, y up along the skin, z out of it. A part
 *    that hangs (a hoop, a drop) is built in its own frame: origin at the
 *    pivot, y up against gravity, z out of the skin; it swings at run time.
 *  - loops (necklaces, bracelets, rings): built along a centre line around
 *    the neck, wrist or finger, given with the skin's outward normal.
 */

export interface PiecePart {
  geometry: BufferGeometry;
  finish: JewelleryFinish;
  color: string;
}

export interface Hanging {
  parts: PiecePart[];
  /** Where it hangs from, in the pinned frame. */
  pivot: Vector3;
  /** Pivot to the centre of mass (m), for the swing. */
  length: number;
}

export interface PinnedPiece {
  parts: PiecePart[];
  hanging?: Hanging;
}

const MM = 0.001;

const part = (geometry: BufferGeometry, finish: JewelleryFinish, color: string): PiecePart => ({
  geometry,
  finish,
  color,
});

/** A ring in the plane of y and z (around x), its top at the origin, hanging down. */
function hangingHoop(radius: number, tube: number): BufferGeometry {
  const hoop = new TorusGeometry(radius, tube, 10, 56);
  hoop.rotateY(Math.PI / 2);
  hoop.translate(0, -radius, 0);
  return hoop;
}

function ball(radius: number, z = radius): BufferGeometry {
  const geometry = new SphereGeometry(radius, 20, 14);
  geometry.translate(0, 0, z);
  return geometry;
}

/** A stone in a low bezel cup, its table facing +z, sitting on the skin. */
function bezelStone(diameter: number, color: string, metal: string): PiecePart[] {
  const stone = brilliant(diameter);
  stone.translate(0, 0, diameter * 0.32);
  const r = diameter / 2;
  const cup = lathe(
    [
      [0, 0],
      [r * 1.1, 0],
      [r * 1.18, r * 0.35],
      [r * 1.04, r * 0.62],
      [r * 0.92, r * 0.5],
    ],
    32,
  );
  cup.rotateX(Math.PI / 2);
  return [part(stone, 'gem', color), part(cup, 'metal', metal)];
}

/** Earrings and piercings, pinned to the skin; null for loops and unknown ids. */
export function pinnedPiece(id: string): PinnedPiece | null {
  const def = findAccessory(id);
  if (!def) return null;
  const color = def.defaultColor;
  switch (id) {
    case 'ear-stud-pearl':
      return { parts: [part(ball(3.2 * MM, 2.4 * MM), 'pearl', color)] };
    case 'ear-stud-gem':
      return { parts: bezelStone(5 * MM, color, SETTING_STEEL) };
    case 'ear-hoop-small':
      return {
        parts: [],
        hanging: {
          parts: [part(hangingHoop(7 * MM, 0.85 * MM), 'metal', color)],
          pivot: new Vector3(0, 0, -1.5 * MM),
          length: 7 * MM,
        },
      };
    case 'ear-hoop-large':
      return {
        parts: [],
        hanging: {
          parts: [part(hangingHoop(16 * MM, 1.1 * MM), 'metal', '#f2c46d')],
          pivot: new Vector3(0, 0, -1.5 * MM),
          length: 16 * MM,
        },
      };
    case 'ear-drop-crystal': {
      const link = hangingHoop(1.6 * MM, 0.4 * MM);
      const stone = brilliant(6 * MM, { outline: pearOutline, elongation: 1.5 });
      stone.rotateZ(Math.PI);
      stone.translate(0, -9 * MM, 1 * MM);
      return {
        parts: [part(ball(1.6 * MM), 'metal', SETTING_STEEL)],
        hanging: {
          parts: [part(link, 'metal', SETTING_STEEL), part(stone, 'gem', color)],
          pivot: new Vector3(0, 0, 0),
          length: 9 * MM,
        },
      };
    }
    case 'ear-dangle-star': {
      const chain = wire(
        [new Vector3(0, 0, 0), new Vector3(0, -5 * MM, 0.2 * MM), new Vector3(0, -10 * MM, 0)],
        0.35 * MM,
      );
      const star = facetedStar(4.5 * MM, 2 * MM, 1.4 * MM);
      star.translate(0, -14 * MM, 0.5 * MM);
      return {
        parts: [part(ball(1.6 * MM), 'metal', color)],
        hanging: {
          parts: [part(merge([chain, star]), 'metal', color)],
          pivot: new Vector3(0, 0, 0),
          length: 13 * MM,
        },
      };
    }
    case 'nose-stud':
    case 'tragus-stud':
      return { parts: bezelStone(2.4 * MM, color, SETTING_STEEL) };
    case 'lip-labret':
      return { parts: bezelStone(2.6 * MM, color, SETTING_STEEL) };
    case 'nose-ring':
      return {
        parts: [],
        hanging: {
          parts: [part(hangingHoop(4.5 * MM, 0.5 * MM), 'metal', color)],
          pivot: new Vector3(0, 0, -1.5 * MM),
          length: 4.5 * MM,
        },
      };
    case 'nose-septum': {
      // A horseshoe through the septum (along x), its balls tipped forward.
      const arc = new TorusGeometry(4.2 * MM, 0.6 * MM, 10, 40, Math.PI * 1.5);
      arc.rotateZ(-Math.PI * 0.25 - Math.PI / 2);
      arc.translate(0, -4.2 * MM, 0);
      const ends = [-1, 1].map((side) => {
        const end = ball(1.2 * MM, 0);
        end.translate(side * 4.2 * Math.SQRT1_2 * MM, -4.2 * (1 - Math.SQRT1_2) * MM, 0);
        return end;
      });
      return {
        parts: [],
        hanging: {
          parts: [part(merge([arc, ...ends]), 'metal', color)],
          pivot: new Vector3(0, 0, 0),
          length: 4 * MM,
        },
      };
    }
    case 'brow-bar': {
      // A curved barbell through the brow: one ball above, one below.
      const balls = [4, -4].map((y) => {
        const end = ball(1.3 * MM, 1 * MM);
        end.translate(0, y * MM, 0);
        return end;
      });
      return { parts: [part(merge(balls), 'metal', color)] };
    }
    case 'helix-ring': {
      // Around the rim's edge: the ring passes through it and over the top.
      const ring = new TorusGeometry(4 * MM, 0.55 * MM, 10, 48);
      ring.rotateY(Math.PI / 2);
      ring.translate(0, 2.2 * MM, -1.2 * MM);
      return { parts: [part(ring, 'metal', color)] };
    }
    case 'helix-studs':
      return { parts: [part(ball(1.3 * MM, 1 * MM), 'metal', color)] };
    case 'navel-ring': {
      const top = ball(2 * MM, 1.5 * MM);
      top.translate(0, 4 * MM, 0);
      const stone = brilliant(5 * MM);
      stone.translate(0, -3.5 * MM, 2.2 * MM);
      const cup = lathe(
        [
          [0, 0],
          [2.8 * MM, 0],
          [2.9 * MM, 1 * MM],
          [2.5 * MM, 1.4 * MM],
        ],
        28,
      );
      cup.rotateX(Math.PI / 2);
      cup.translate(0, -3.5 * MM, 0.6 * MM);
      return {
        parts: [part(merge([top, cup]), 'metal', SETTING_STEEL), part(stone, 'gem', color)],
      };
    }
    default:
      return null;
  }
}

/** Items built along a loop around the neck, wrist or finger. */
export const LOOP_SLOTS = new Set(['neck', 'wrist', 'finger']);

/** How a loop item sits: its drop below the neck's base or how loose around a limb. */
export interface LoopFit {
  /** Neck items: how far the front hangs below the base of the neck (m); chokers sit higher. */
  drop?: number;
  choker?: boolean;
  /** Gap between the skin and the piece's inside (m). */
  clearance: number;
  /** The piece's own half thickness across the skin (m). */
  thickness: number;
  /** Limb items: hold a round, rigid shape this much looser than the limb (m). */
  round?: number;
  /** Along the limb from its upper joint (0) to its lower (1). */
  along?: number;
}

export const LOOP_FIT: Record<string, LoopFit> = {
  'neck-chain-fine': { drop: 0.045, clearance: 0.0015, thickness: 0.0008 },
  'neck-pendant-heart': { drop: 0.06, clearance: 0.0015, thickness: 0.0008 },
  'neck-pendant-moon': { drop: 0.06, clearance: 0.0015, thickness: 0.0008 },
  'neck-pearls': { drop: 0.025, clearance: 0.0015, thickness: 0.003 },
  'neck-choker-velvet': { choker: true, clearance: 0.001, thickness: 0.0008 },
  'neck-choker-chain': { choker: true, clearance: 0.0015, thickness: 0.0015 },
  'wrist-bangle': { clearance: 0.002, thickness: 0.002, round: 0.009, along: 0.95 },
  'wrist-chain': { clearance: 0.0015, thickness: 0.001, along: 0.93 },
  'wrist-watch': { clearance: 0.001, thickness: 0.0012, along: 0.88 },
  'wrist-beads': { clearance: 0.001, thickness: 0.0035, along: 0.92 },
  'ring-band': { clearance: 0.0003, thickness: 0.0009, round: 0, along: 0.45 },
  'ring-solitaire': { clearance: 0.0003, thickness: 0.0007, round: 0, along: 0.45 },
  'ring-signet': { clearance: 0.0003, thickness: 0.001, round: 0, along: 0.45 },
};

/** Points spaced `pitch` apart along a polyline, with their tangents. */
function resample(path: readonly Vector3[], closed: boolean, pitch: number) {
  const points = closed ? [...path, path[0]!] : [...path];
  const out: { at: Vector3; tangent: Vector3; index: number }[] = [];
  let carry = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const length = a.distanceTo(b);
    const tangent = b.clone().sub(a).normalize();
    for (let s = carry; s < length; s += pitch) {
      out.push({ at: a.clone().lerp(b, s / length), tangent, index: i % path.length });
    }
    carry = (((carry - length) % pitch) + pitch) % pitch;
  }
  return out;
}

const basis = new Matrix4();
const quaternion = new Quaternion();

/** A quaternion taking z to `forward` and x to `side` (made orthogonal). */
function orient(forward: Vector3, side: Vector3): Quaternion {
  const z = forward.clone().normalize();
  const x = side.clone().addScaledVector(z, -side.dot(z)).normalize();
  const y = new Vector3().crossVectors(z, x);
  basis.makeBasis(x, y, z);
  return quaternion.setFromRotationMatrix(basis).clone();
}

/** Interlocked oval links along a path, alternately turned a quarter. */
function chainAlong(
  path: readonly Vector3[],
  normals: readonly Vector3[],
  closed: boolean,
  link: { length: number; width: number; wire: number },
): BufferGeometry {
  const template = chainLink(link.length, link.width, link.wire, 5, 3);
  const links = resample(path, closed, link.length).map(({ at, tangent, index }, i) => {
    const normal = normals[index]!;
    const side = i % 2 ? normal : new Vector3().crossVectors(tangent, normal);
    return place(template.clone(), at, orient(tangent, side));
  });
  template.dispose();
  return merge(links);
}

/** Spheres (pearls, beads) touching along a path. */
function beadsAlong(
  path: readonly Vector3[],
  closed: boolean,
  radius: number,
  faceted = false,
): BufferGeometry {
  const template = new SphereGeometry(radius, faceted ? 8 : 18, faceted ? 6 : 12);
  const beads = resample(path, closed, radius * 2.05).map(({ at }) => place(template.clone(), at));
  template.dispose();
  return merge(beads);
}

/** A flat solid from a 2D shape, placed on the skin at `at` facing `normal`, top towards `up`. */
function medallion(
  shape: Shape,
  size: number,
  depth: number,
  at: Vector3,
  normal: Vector3,
  up: Vector3,
): BufferGeometry {
  const solid = bevelledSolid(shape, depth / size, 0.06, { curveSegments: 18 });
  solid.scale(size, size, size);
  const side = new Vector3().crossVectors(up, normal);
  return place(solid, at.clone().addScaledVector(normal, depth / 2), orient(normal, side));
}

/** The lowest point of a neck loop (the front), its index. */
function lowest(path: readonly Vector3[], up: Vector3): number {
  let best = 0;
  path.forEach((point, i) => {
    if (point.dot(up) < path[best]!.dot(up)) best = i;
  });
  return best;
}

/**
 * A loop item along its centre line (closed, the skin's outward normal at each
 * point; `up` is the character's up, `dorsal` the back of the hand for wrist
 * and finger items). Null for ids that are not loop items.
 */
export function loopPiece(
  id: string,
  path: readonly Vector3[],
  normals: readonly Vector3[],
  up: Vector3,
  dorsal?: Vector3,
): PiecePart[] | null {
  const def = findAccessory(id);
  if (!def || !LOOP_SLOTS.has(def.slot)) return null;
  const color = def.defaultColor;
  const smooth = smoothPath(path, true, Math.max(48, path.length * 2));
  // The normal of the nearest original point, for each smoothed one.
  const smoothNormals = smooth.map((point) => {
    let best = 0;
    path.forEach((candidate, i) => {
      if (candidate.distanceToSquared(point) < path[best]!.distanceToSquared(point)) best = i;
    });
    return normals[best]!;
  });
  const top = (index: number) => {
    const at = smooth[index]!;
    return { at, normal: smoothNormals[index]! };
  };
  const dorsalIndex = () => {
    let best = 0;
    smoothNormals.forEach((normal, i) => {
      if (dorsal && normal.dot(dorsal) > smoothNormals[best]!.dot(dorsal)) best = i;
    });
    return best;
  };

  switch (id) {
    case 'neck-chain-fine':
      return [
        part(
          chainAlong(smooth, smoothNormals, true, {
            length: 2.2 * MM,
            width: 1.2 * MM,
            wire: 0.3 * MM,
          }),
          'metal',
          color,
        ),
      ];
    case 'neck-pendant-heart':
    case 'neck-pendant-moon': {
      const chain = chainAlong(smooth, smoothNormals, true, {
        length: 2 * MM,
        width: 1.1 * MM,
        wire: 0.28 * MM,
      });
      const front = top(lowest(smooth, up));
      const hangsAt = front.at.clone().addScaledVector(up, -7 * MM);
      const shape = id === 'neck-pendant-heart' ? heartShape(1) : crescentShape(1);
      const charm = medallion(shape, 11 * MM, 1.6 * MM, hangsAt, front.normal, up);
      const bail = new TorusGeometry(1.4 * MM, 0.35 * MM, 8, 24);
      const bailAt = front.at
        .clone()
        .addScaledVector(up, -1.2 * MM)
        .addScaledVector(front.normal, 0.8 * MM);
      return [
        part(chain, 'metal', color),
        part(
          merge([
            charm,
            place(bail, bailAt, orient(new Vector3().crossVectors(up, front.normal), front.normal)),
          ]),
          'metal',
          color,
        ),
      ];
    }
    case 'neck-pearls':
      return [part(beadsAlong(smooth, true, 3 * MM), 'pearl', color)];
    case 'neck-choker-velvet': {
      const ribbon = sweep({
        path: smooth,
        closed: true,
        profile: roundedRectProfile(1.4 * MM, 12 * MM, 0.6 * MM),
        normals: smoothNormals,
      });
      return [part(ribbon, 'velvet', color)];
    }
    case 'neck-choker-chain':
      return [
        part(
          chainAlong(smooth, smoothNormals, true, {
            length: 4.5 * MM,
            width: 3 * MM,
            wire: 0.75 * MM,
          }),
          'metal',
          color,
        ),
      ];
    case 'wrist-bangle':
      return [
        part(
          sweep({
            path: smooth,
            closed: true,
            profile: circleProfile(2 * MM, 14),
            normals: smoothNormals,
          }),
          'metal',
          color,
        ),
      ];
    case 'wrist-chain':
      return [
        part(
          chainAlong(smooth, smoothNormals, true, {
            length: 3 * MM,
            width: 1.8 * MM,
            wire: 0.45 * MM,
          }),
          'metal',
          color,
        ),
      ];
    case 'wrist-beads':
      return [part(beadsAlong(smooth, true, 3.5 * MM, true), 'gem', color)];
    case 'wrist-watch': {
      const band = sweep({
        path: smooth,
        closed: true,
        profile: roundedRectProfile(1.6 * MM, 14 * MM, 0.6 * MM),
        normals: smoothNormals,
      });
      const face = top(dorsalIndex());
      const axis = new Vector3().crossVectors(face.normal, up).normalize();
      const caseShape = lathe(
        [
          [0, 0],
          [14 * MM, 0],
          [14.5 * MM, 4 * MM],
          [13.2 * MM, 7 * MM],
          [12 * MM, 7 * MM],
        ],
        48,
      );
      caseShape.rotateX(Math.PI / 2);
      const dial = new CylinderGeometry(12 * MM, 12 * MM, 0.6 * MM, 48);
      dial.rotateX(Math.PI / 2);
      dial.translate(0, 0, 6.2 * MM);
      const at = face.at.clone().addScaledVector(face.normal, 0.8 * MM);
      const turn = orient(face.normal, axis.lengthSq() > 0 ? axis : new Vector3(1, 0, 0));
      return [
        part(merge([band, place(caseShape, at, turn)]), 'metal', color),
        part(place(dial, at, turn), 'gem', '#1b2230'),
      ];
    }
    case 'ring-band':
      return [
        part(
          sweep({
            path: smooth,
            closed: true,
            profile: dProfile(1.3 * MM, 3 * MM),
            normals: smoothNormals,
          }),
          'metal',
          color,
        ),
      ];
    case 'ring-solitaire': {
      const band = sweep({
        path: smooth,
        closed: true,
        profile: dProfile(1 * MM, 2 * MM),
        normals: smoothNormals,
      });
      const face = top(dorsalIndex());
      const along = new Vector3().crossVectors(face.normal, up);
      const turn = orient(face.normal, along.lengthSq() > 0 ? along : new Vector3(1, 0, 0));
      const at = face.at.clone().addScaledVector(face.normal, 1 * MM);
      const setting = bezelStone(5 * MM, color, '#e6e9ee');
      return [
        part(band, 'metal', '#e6e9ee'),
        ...setting.map((piece) => ({ ...piece, geometry: place(piece.geometry, at, turn) })),
      ];
    }
    case 'ring-signet': {
      const band = sweep({
        path: smooth,
        closed: true,
        profile: dProfile(1.4 * MM, 3.5 * MM),
        normals: smoothNormals,
      });
      const face = top(dorsalIndex());
      const oval = new Shape();
      oval.absellipse(0, 0, 0.5, 0.4, 0, Math.PI * 2, false, 0);
      const plate = medallion(oval, 12 * MM, 2.4 * MM, face.at, face.normal, up);
      return [part(merge([band, plate]), 'metal', color)];
    }
    default:
      return null;
  }
}
