"""Where the toes sit inside a sock: `bodies/<gender>/socks.bin`.

The web draws socks on the body skin (`web/src/features/avatar/mh/socks.ts`), so on bare
feet they would show every toe and the grooves between them. Knit fabric spans those: it
follows the foot's outline, not its gaps. This module works that outline out once per
converted body:

1. Each foot below the ankle is voxelized (ray parity along x, 1 mm voxels).
2. The solid is closed morphologically with a ball of `CLOSING_RADIUS`: gaps and grooves
   narrower than about twice that fill, convex shapes stay as they were.
3. The toe vertices (weighted to the toe and ball bones) move onto the closed surface.
   A side facing the next toe across a filled gap meets it halfway, so the gap closes
   all along, out to its open front between the toe tips. Every other vertex (the walls
   of the grooves over and under the toes) snaps onto the closed surface along its
   distance gradient. The field is blurred, so the result is smooth without evening the
   vertices out (which would slide them and drag the UVs).
4. Their normals become those of a softer copy of the closed surface (NORMAL_BLUR),
   blended in by the toe weight.

The file holds, for the vertices that move, their index into the body GLB's vertex order
and their offset and normal delta in the GLB's space (metres, Y up). The web adds both in
the vertex shader while socks are worn, so `body.glb` (and every garment fitted to it)
stays as it is.

Layout, little-endian: magic `MHSK`, u32 version, u32 count, then u32 indices[count],
f32 offsets[count * 3], f32 normal deltas[count * 3].
"""

import struct
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numpy.typing import NDArray
from scipy import ndimage

from asset_pipeline.mh.glb import accessor_values, read_glb

F64 = NDArray[np.float64]

MAGIC = b"MHSK"
FORMAT_VERSION = 1
#: Bumped whenever the envelope changes (part of the build fingerprint).
SOCK_TOES_VERSION = "sock-toes-v4"

VOXEL = 0.001
#: Grooves narrower than about twice this fill; the toe gaps are 2-8 mm, the notches
#: between the toe tips and over the toes up to ~15 mm.
CLOSING_RADIUS = 0.018
#: Blur of the closed surface's distance field (voxels), against the voxel staircase.
FIELD_BLUR = 1.5
#: Blur of the field the normals come from (voxels): knit shades softly, without the
#: creases the snapped toes still leave between them.
NORMAL_BLUR = 6.0
#: The foot is everything under this height; the leg above is left out of the voxels.
FOOT_HEIGHT = 0.09
#: Toe weight (toe + ball bones) where the envelope starts and where it holds in full.
WEIGHT_START, WEIGHT_FULL = 0.02, 0.35
SNAP_STEPS = 10
#: The widest gap a side crosses to meet the next toe, and the march step.
MEET_REACH, MEET_STEP = 0.012, 0.00025
#: A side meets across the gap when its normal and the way out of the filled volume
#: (the distance gradient) are at least this far apart: |n . g| below it.
MEET_ALIGNMENT = 0.5
#: Offsets and normal changes below these are not written.
MIN_OFFSET, MIN_NORMAL = 1e-5, 1e-4


@dataclass(frozen=True)
class SockToes:
    indices: NDArray[np.uint32]
    offsets: NDArray[np.float32]
    normals: NDArray[np.float32]

    @property
    def reach(self) -> float:
        """The longest offset (m)."""
        return float(np.linalg.norm(self.offsets, axis=1).max()) if len(self.indices) else 0.0


def smoothstep(edge0: float, edge1: float, x: F64) -> F64:
    t = np.clip((x - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def toe_weights(names: list[str], joints: NDArray[np.int64], weights: F64) -> F64:
    """Per vertex, the weight its toe and ball bones carry (MetaHuman names)."""
    toe = np.array(["toe" in name or name.startswith("ball_") for name in names])
    return (weights * toe[joints]).sum(axis=1)


def voxelize(
    triangles: F64, lo: F64, shape: tuple[int, int, int], voxel: float
) -> NDArray[np.bool_]:
    """Solid voxels of a surface that is closed for rays along x through the grid: each
    (y, z) column is filled between pairs of crossings."""
    solid = np.zeros(shape, dtype=bool)
    ys = lo[1] + (np.arange(shape[1]) + 0.5) * voxel
    zs = lo[2] + (np.arange(shape[2]) + 0.5) * voxel
    y_min, y_max = triangles[:, :, 1].min(axis=1), triangles[:, :, 1].max(axis=1)
    z_min, z_max = triangles[:, :, 2].min(axis=1), triangles[:, :, 2].max(axis=1)
    for j, y in enumerate(ys):
        rows = np.flatnonzero((y_min <= y) & (y_max >= y))
        for k, z in enumerate(zs):
            hit = rows[(z_min[rows] <= z) & (z_max[rows] >= z)]
            if hit.size == 0:
                continue
            a, b, c = triangles[hit, 0], triangles[hit, 1], triangles[hit, 2]
            e0, e1 = b[:, 1:] - a[:, 1:], c[:, 1:] - a[:, 1:]
            d = np.array([y, z]) - a[:, 1:]
            det = e0[:, 0] * e1[:, 1] - e1[:, 0] * e0[:, 1]
            valid = np.abs(det) > 1e-14
            safe = np.where(valid, det, 1.0)
            u = np.where(valid, (d[:, 0] * e1[:, 1] - e1[:, 0] * d[:, 1]) / safe, -1.0)
            v = np.where(valid, (e0[:, 0] * d[:, 1] - d[:, 0] * e0[:, 1]) / safe, -1.0)
            inside = valid & (u >= 0) & (v >= 0) & (u + v <= 1)
            if not inside.any():
                continue
            xs = np.sort(
                a[inside, 0]
                + u[inside] * (b[inside, 0] - a[inside, 0])
                + v[inside] * (c[inside, 0] - a[inside, 0])
            )
            for x0, x1 in zip(xs[0::2], xs[1::2], strict=False):
                i0 = int(np.ceil((x0 - lo[0]) / voxel - 0.5))
                i1 = int(np.floor((x1 - lo[0]) / voxel - 0.5))
                if i1 >= i0:
                    solid[max(i0, 0) : i1 + 1, j, k] = True
    return solid


def distance_field(solid: NDArray[np.bool_], voxel: float, blur: float = FIELD_BLUR) -> F64:
    """Signed distance (m, negative inside) to a voxel solid, blurred by `blur` voxels."""
    field = (ndimage.distance_transform_edt(~solid) - ndimage.distance_transform_edt(solid)) * voxel
    return ndimage.gaussian_filter(field, blur)


def closing(solid: NDArray[np.bool_], radius: float, voxel: float) -> NDArray[np.bool_]:
    """The solid closed with a ball of `radius` (the grid needs a margin of over 2 radii)."""
    dilated = ndimage.distance_transform_edt(~solid) * voxel <= radius
    return (ndimage.distance_transform_edt(dilated) * voxel > radius) | solid


class Field:
    """Trilinear samples of a voxel field and of its gradient."""

    def __init__(self, values: F64, lo: F64, voxel: float) -> None:
        self.values, self.lo, self.voxel = values, lo, voxel
        self.gradient = np.gradient(values, voxel)

    def _coords(self, points: F64) -> F64:
        return ((points - self.lo) / self.voxel - 0.5).T

    def __call__(self, points: F64) -> F64:
        return ndimage.map_coordinates(self.values, self._coords(points), order=1, mode="nearest")

    def normal(self, points: F64) -> F64:
        coords = self._coords(points)
        g = np.stack(
            [ndimage.map_coordinates(c, coords, order=1, mode="nearest") for c in self.gradient],
            axis=1,
        )
        return g / np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-12)


def snap(points: F64, field: Field, steps: int = SNAP_STEPS) -> F64:
    """Points moved onto the field's zero level along its gradient."""
    q = points.copy()
    for _ in range(steps):
        q -= field(q)[:, None] * field.normal(q)
    return q


def meet_across(
    points: F64, normals: F64, closed: Field, solid: Field
) -> tuple[F64, NDArray[np.bool_]]:
    """For vertices whose normal crosses a gap the closing filled and reaches the next
    toe while still inside the closed volume, the point halfway across; and which do."""
    steps = np.arange(1, round(MEET_REACH / MEET_STEP) + 1) * MEET_STEP
    count = len(points)
    if count == 0:
        return points.copy(), np.zeros(0, dtype=bool)
    rays = (points[:, None, :] + normals[:, None, :] * steps[None, :, None]).reshape(-1, 3)
    inside_closed = closed(rays).reshape(count, -1) <= 0
    in_solid = solid(rays).reshape(count, -1) < 0
    # Out of the own toe first, then into the next one, never out of the closed volume.
    left = np.maximum.accumulate(~in_solid, axis=1)
    reached = left & in_solid
    first_reach = np.where(reached.any(axis=1), reached.argmax(axis=1), len(steps))
    escaped = ~inside_closed
    first_escape = np.where(escaped.any(axis=1), escaped.argmax(axis=1), len(steps))
    meets = (first_reach < len(steps)) & (first_reach < first_escape)
    across = np.abs((normals * closed.normal(points)).sum(axis=1)) < MEET_ALIGNMENT
    meets &= across
    halfway = steps[np.minimum(first_reach, len(steps) - 1)] / 2
    return points + normals * halfway[:, None], meets


def envelope(
    positions: F64,
    normals: F64,
    indices: NDArray[np.int64],
    weight: F64,
    *,
    radius: float = CLOSING_RADIUS,
    voxel: float = VOXEL,
    foot_height: float = FOOT_HEIGHT,
) -> tuple[F64, F64]:
    """Offsets and new normals for every vertex (zero offset and the old normal where
    `weight` is 0). Each foot (x > 0 and x < 0) is closed on its own."""
    triangles = indices.reshape(-1, 3)
    offsets = np.zeros_like(positions)
    result = normals.copy()
    for side in (1.0, -1.0):
        foot = (side * positions[:, 0] > 0) & (positions[:, 1] < foot_height)
        moving = foot & (weight > 0)
        if not moving.any():
            continue
        margin = 2 * radius + 4 * voxel
        lo = positions[moving].min(axis=0) - margin
        hi = positions[moving].max(axis=0) + margin
        hi[1] = min(hi[1], foot_height)
        shape = tuple(int(n) for n in np.ceil((hi - lo) / voxel))
        closed_triangles = triangles[foot[triangles].all(axis=1)]
        solid = voxelize(positions[closed_triangles], lo, shape, voxel)
        closed = closing(solid, radius, voxel)
        field = Field(distance_field(closed, voxel), lo, voxel)
        shading = Field(distance_field(closed, voxel, NORMAL_BLUR), lo, voxel)
        # The same snap onto the unclosed solid: what the voxels alone move a vertex by
        # (up to half a voxel). Taking it off leaves only what the closing adds.
        baseline = Field(distance_field(solid, voxel), lo, voxel)

        index = np.flatnonzero(moving)
        snapped = snap(positions[index], field) - (
            snap(positions[index], baseline) - positions[index]
        )
        # Unblurred: a blur narrows a 2 mm gap and the next toe would seem nearer.
        walls = Field(distance_field(solid, voxel, blur=0.0), lo, voxel)
        met, meets = meet_across(positions[index], normals[index], field, walls)
        snapped[meets] = met[meets]
        w = weight[index][:, None]
        offsets[index] = (snapped - positions[index]) * w
        blended = normals[index] * (1 - w) + shading.normal(snapped) * w
        result[index] = blended / np.maximum(np.linalg.norm(blended, axis=1, keepdims=True), 1e-12)
    return offsets, result


def sock_toes_from_glb(body_glb: Path) -> SockToes:
    """The envelope of a converted body GLB (one skinned primitive)."""
    document, binary = read_glb(body_glb.read_bytes())
    (primitive,) = document["meshes"][0]["primitives"]
    attributes = primitive["attributes"]
    positions = accessor_values(document, binary, attributes["POSITION"])
    normals = accessor_values(document, binary, attributes["NORMAL"])
    normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-12)
    indices = accessor_values(document, binary, primitive["indices"]).astype(np.int64).ravel()
    joints = accessor_values(document, binary, attributes["JOINTS_0"]).astype(np.int64)
    weights = accessor_values(document, binary, attributes["WEIGHTS_0"])
    skin = document["skins"][0]
    names = [str(document["nodes"][j].get("name", "")) for j in skin["joints"]]
    weight = smoothstep(WEIGHT_START, WEIGHT_FULL, toe_weights(names, joints, weights))
    offsets, new_normals = envelope(positions, normals, indices, weight)
    deltas = new_normals - normals
    keep = (np.abs(offsets).max(axis=1) > MIN_OFFSET) | (np.abs(deltas).max(axis=1) > MIN_NORMAL)
    return SockToes(
        indices=np.flatnonzero(keep).astype(np.uint32),
        offsets=offsets[keep].astype(np.float32),
        normals=deltas[keep].astype(np.float32),
    )


def write_sock_toes(toes: SockToes, path: Path) -> None:
    count = len(toes.indices)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(
        MAGIC
        + struct.pack("<II", FORMAT_VERSION, count)
        + toes.indices.astype("<u4").tobytes()
        + toes.offsets.astype("<f4").tobytes()
        + toes.normals.astype("<f4").tobytes()
    )


def read_sock_toes(path: Path) -> SockToes:
    data = path.read_bytes()
    if data[:4] != MAGIC:
        raise ValueError(f"{path.name}: not a sock toes file")
    version, count = struct.unpack_from("<II", data, 4)
    if version != FORMAT_VERSION:
        raise ValueError(f"{path.name}: format {version}, expected {FORMAT_VERSION}")
    offset = 12
    indices = np.frombuffer(data, "<u4", count, offset)
    offset += 4 * count
    offsets = np.frombuffer(data, "<f4", 3 * count, offset).reshape(count, 3)
    offset += 12 * count
    normals = np.frombuffer(data, "<f4", 3 * count, offset).reshape(count, 3)
    return SockToes(indices=indices.copy(), offsets=offsets.copy(), normals=normals.copy())
