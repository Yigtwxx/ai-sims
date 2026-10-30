import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { ACCESSORIES } from './catalog';
import { LOOP_FIT, LOOP_SLOTS, loopPiece, pinnedPiece } from './pieces';

/** A circle of `radius` around the y axis at height 1.4, normals pointing out. */
function ring(radius: number, count = 48) {
  const path: Vector3[] = [];
  const normals: Vector3[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2;
    const normal = new Vector3(Math.sin(a), 0, Math.cos(a));
    normals.push(normal);
    path.push(
      normal
        .clone()
        .multiplyScalar(radius)
        .setY(1.4 - 0.03 * Math.max(0, Math.cos(a))),
    );
  }
  return { path, normals };
}

const bounds = (parts: { geometry: { computeBoundingBox: () => void; boundingBox: unknown } }[]) =>
  parts.map((part) => {
    part.geometry.computeBoundingBox();
    return part.geometry.boundingBox as { min: Vector3; max: Vector3 };
  });

describe('pieces', () => {
  it('builds every catalogue item as a pinned piece or a loop', () => {
    for (const def of ACCESSORIES) {
      if (LOOP_SLOTS.has(def.slot)) {
        expect(LOOP_FIT[def.id], def.id).toBeDefined();
        const { path, normals } = ring(def.slot === 'finger' ? 0.009 : 0.06);
        const parts = loopPiece(def.id, path, normals, new Vector3(0, 1, 0), new Vector3(0, 0, 1));
        expect(parts?.length, def.id).toBeGreaterThan(0);
      } else {
        const piece = pinnedPiece(def.id);
        expect(piece, def.id).not.toBeNull();
        expect(piece!.parts.length + (piece!.hanging?.parts.length ?? 0), def.id).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it('keeps pinned pieces small and on the outside of the skin', () => {
    for (const def of ACCESSORIES.filter((d) => !LOOP_SLOTS.has(d.slot))) {
      const piece = pinnedPiece(def.id)!;
      for (const box of bounds(piece.parts)) {
        expect(box.max.z, def.id).toBeGreaterThan(0);
        expect(box.max.clone().sub(box.min).length(), def.id).toBeLessThan(0.03);
      }
    }
  });

  it('hangs hoops below their pivot, the top passing through it', () => {
    const hoop = pinnedPiece('ear-hoop-small')!.hanging!;
    const [box] = bounds(hoop.parts);
    expect(box!.max.y).toBeCloseTo(0.00085, 4);
    expect(box!.min.y).toBeCloseTo(-0.0148, 3);
    expect(hoop.length).toBeGreaterThan(0);
  });

  it('builds a necklace around its centre line, the pendant at the front', () => {
    const { path, normals } = ring(0.06);
    const parts = loopPiece('neck-pendant-heart', path, normals, new Vector3(0, 1, 0))!;
    const [chain, charm] = bounds(parts);
    expect(chain!.max.x).toBeGreaterThan(0.058);
    expect(chain!.min.x).toBeLessThan(-0.058);
    // The charm (and its bail) hangs from the lowest point, in front.
    expect(charm!.max.y).toBeLessThan(1.372);
    expect(charm!.min.y).toBeLessThan(1.36);
    expect(charm!.min.z).toBeGreaterThan(0.05);
  });

  it('knows nothing of ids outside the catalogue', () => {
    expect(pinnedPiece('face-glasses-round')).toBeNull();
    expect(loopPiece('hair-bow-ribbon', [], [], new Vector3())).toBeNull();
    expect(loopPiece('ear-hoop-small', [], [], new Vector3())).toBeNull();
  });
});
