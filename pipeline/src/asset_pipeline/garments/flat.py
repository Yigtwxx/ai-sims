"""Flat pattern pieces sewn together in the simulation.

A piece is a closed outline of named segments in pattern space (metres, u across, v up,
counter-clockwise seen from the outside of the garment). `layout` resamples every segment
(both sides of a seam with the same count), triangulates each piece and returns one mesh
whose vertices keep their flat coordinates (the cloth's rest shape and the UVs) and the
pairs of vertices Blender's sewing springs pull together. A placement function per piece
puts its flat points around the body to start the simulation from.
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy.spatial import Delaunay, cKDTree

from asset_pipeline.garments import GarmentError
from asset_pipeline.garments.pattern import UV_MARGIN, shelf_pack

F64 = NDArray[np.float64]
I64 = NDArray[np.int64]

Place = Callable[[F64], F64]  # (N, 2) flat points -> (N, 3) around the body


@dataclass(frozen=True, eq=False)
class Segment:
    name: str
    points: F64  # (N, 2) polyline, in outline order; its last point starts the next segment

    @property
    def length(self) -> float:
        return float(np.linalg.norm(np.diff(self.points, axis=0), axis=1).sum())


@dataclass(frozen=True, eq=False)
class Piece:
    name: str
    segments: tuple[Segment, ...]
    place: Place

    def segment(self, name: str) -> Segment:
        for segment in self.segments:
            if segment.name == name:
                return segment
        raise GarmentError(f"piece {self.name!r} has no segment {name!r}")


@dataclass(frozen=True)
class Seam:
    """Segment `a_seg` of piece `a` sewn to `b_seg` of piece `b`. Their directions are
    matched by where the pieces are placed."""

    a: str
    a_seg: str
    b: str
    b_seg: str


@dataclass(frozen=True, eq=False)
class FlatMesh:
    positions: F64  # (V, 3) placed around the body
    flat: F64  # (V, 2) on the pattern, pieces apart (the cloth's rest shape)
    faces: I64  # (F, 3), outward winding
    uvs: F64  # (V, 2) atlas
    pairs: I64  # (P, 2) vertices the sewing springs pull together
    piece: I64  # (V,) piece index
    names: tuple[str, ...]  # piece names
    segments: dict[tuple[str, str], I64] = field(default_factory=dict)  # vertex run
    seams: tuple[Seam, ...] = ()
    uv_metres: float = 1.0  # pattern metres one UV unit spans

    def sewn(self, piece: str, segment: str) -> bool:
        return any(
            (s.a, s.a_seg) == (piece, segment) or (s.b, s.b_seg) == (piece, segment)
            for s in self.seams
        )

    def corner_uvs(self) -> F64:
        return self.uvs[self.faces]

    def welds(self) -> list[list[int]]:
        """Groups of vertices the seams join into one (corners join more than two)."""
        parent = np.arange(len(self.positions))

        def root(v: int) -> int:
            while parent[v] != v:
                parent[v] = parent[parent[v]]
                v = int(parent[v])
            return v

        for a, b in self.pairs:
            ra, rb = root(int(a)), root(int(b))
            if ra != rb:
                parent[max(ra, rb)] = min(ra, rb)
        groups: dict[int, list[int]] = {}
        for v in np.unique(self.pairs):
            groups.setdefault(root(int(v)), []).append(int(v))
        return [sorted(g) for g in groups.values() if len(g) > 1]

    def to_json(self) -> dict[str, Any]:
        flat3 = np.c_[self.flat[:, 0], np.zeros(len(self.flat)), self.flat[:, 1]]
        return {
            "positions": np.round(self.positions, 6).tolist(),
            "faces": self.faces.tolist(),
            "corner_uvs": np.round(self.corner_uvs(), 6).tolist(),
            "pin": [0.0] * len(self.positions),
            "rest": np.round(flat3, 6).tolist(),
            "sew": self.pairs.tolist(),
            "welds": self.welds(),
        }


# ------------------------------------------------------------------------------ curves


def bezier(p0: F64, p1: F64, p2: F64, p3: F64, count: int = 32) -> F64:
    t = np.linspace(0.0, 1.0, count)[:, None]
    s = 1.0 - t
    return s**3 * p0 + 3 * s * s * t * p1 + 3 * s * t * t * p2 + t**3 * p3


def polyline(*points: Sequence[float]) -> F64:
    return np.array(points, dtype=np.float64)


def resample(points: F64, count: int) -> F64:
    """`count` points at equal arc length along a polyline (ends kept)."""
    steps = np.linalg.norm(np.diff(points, axis=0), axis=1)
    arc = np.concatenate([[0.0], np.cumsum(steps)])
    targets = np.linspace(0.0, arc[-1], count)
    return np.stack([np.interp(targets, arc, points[:, d]) for d in range(points.shape[1])], 1)


def offset_line(points: F64, distance: float) -> F64:
    """A polyline moved `distance` to its left (into a counter-clockwise outline)."""
    tangent = np.gradient(points, axis=0)
    tangent /= np.maximum(np.linalg.norm(tangent, axis=1, keepdims=True), 1e-12)
    return points + distance * np.stack([-tangent[:, 1], tangent[:, 0]], 1)


# ------------------------------------------------------------------------ triangulate


def _inside(polygon: F64, points: F64) -> NDArray[np.bool_]:
    """Even-odd test of points against a closed polygon."""
    x, y = points[:, 0][:, None], points[:, 1][:, None]
    a = polygon
    b = np.roll(polygon, -1, 0)
    crosses = (a[:, 1] > y) != (b[:, 1] > y)
    with np.errstate(divide="ignore", invalid="ignore"):
        at = a[:, 0] + (y - a[:, 1]) * (b[:, 0] - a[:, 0]) / (b[:, 1] - a[:, 1])
    return ((crosses & (x < at)).sum(1) % 2).astype(bool)


def _segment_distance(polygon: F64, points: F64) -> F64:
    a = polygon
    b = np.roll(polygon, -1, 0)
    ab = b - a
    t = np.einsum("pkd,kd->pk", points[:, None] - a[None], ab) / np.maximum(
        np.einsum("kd,kd->k", ab, ab), 1e-18
    )
    closest = a[None] + np.clip(t, 0.0, 1.0)[..., None] * ab[None]
    return np.linalg.norm(points[:, None] - closest, axis=2).min(1)


def triangulate(outline: F64, spacing: float, smooth: int = 4) -> tuple[F64, I64]:
    """Points (outline first, in order, then the interior) and counter-clockwise triangles
    of a closed outline: a triangular lattice inside, Delaunay, outside triangles dropped."""
    lo, hi = outline.min(0), outline.max(0)
    row = spacing * np.sqrt(3.0) / 2.0
    lattice = []
    for i, v in enumerate(np.arange(lo[1], hi[1] + row, row)):
        shift = 0.5 * spacing if i % 2 else 0.0
        us = np.arange(lo[0] + shift, hi[0] + spacing, spacing)
        lattice.append(np.stack([us, np.full_like(us, v)], 1))
    grid = np.concatenate(lattice)
    grid = grid[_inside(outline, grid)]
    grid = grid[_segment_distance(outline, grid) > 0.55 * spacing]
    points = np.concatenate([outline, grid])
    triangles = Delaunay(points).simplices.astype(np.int64)
    centroids = points[triangles].mean(1)
    triangles = triangles[_inside(outline, centroids)]
    p = points[triangles]
    e1, e2 = p[:, 1] - p[:, 0], p[:, 2] - p[:, 0]
    area = e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]
    triangles = np.where((area < 0)[:, None], triangles[:, ::-1], triangles)
    # Delaunay joins runs of collinear outline points (a straight seam) with flat slivers
    # that overlap the real triangles there.
    triangles = triangles[np.abs(area) > 1e-3 * spacing * spacing]
    # Laplacian relaxation of the interior points, the outline fixed.
    n = len(outline)
    edges = np.concatenate([triangles[:, [0, 1]], triangles[:, [1, 2]], triangles[:, [2, 0]]])
    for _ in range(smooth):
        total = np.zeros_like(points)
        count = np.zeros(len(points))
        np.add.at(total, edges[:, 0], points[edges[:, 1]])
        np.add.at(total, edges[:, 1], points[edges[:, 0]])
        np.add.at(count, edges[:, 0], 1)
        np.add.at(count, edges[:, 1], 1)
        relaxed = total / np.maximum(count, 1)[:, None]
        points[n:] = 0.5 * points[n:] + 0.5 * relaxed[n:]
    return points, triangles


# ---------------------------------------------------------------------------- layout


def _counts(
    pieces: Mapping[str, Piece], seams: Sequence[Seam], spacing: float
) -> dict[tuple[str, str], int]:
    counts: dict[tuple[str, str], int] = {}
    for piece in pieces.values():
        for segment in piece.segments:
            counts[(piece.name, segment.name)] = max(2, round(segment.length / spacing) + 1)
    for seam in seams:
        a, b = (seam.a, seam.a_seg), (seam.b, seam.b_seg)
        shared = max(counts[a], counts[b])
        counts[a] = counts[b] = shared
    return counts


def layout(
    pieces: Sequence[Piece], seams: Sequence[Seam], spacing: float, turn_uv: bool = False
) -> FlatMesh:
    """`turn_uv` lays the pieces a quarter turn round in the UV atlas, for woven maps whose
    grain runs along u (a knit's wales then run down the body)."""
    by_name = {p.name: p for p in pieces}
    if len(by_name) != len(pieces):
        raise GarmentError("piece names repeat")
    counts = _counts(by_name, seams, spacing)

    sizes = []
    for piece in pieces:
        outline = np.concatenate([s.points for s in piece.segments])
        sizes.append(tuple(np.ptp(_turn(outline) if turn_uv else outline, 0)))
    offsets, side = shelf_pack(sizes, UV_MARGIN)

    positions: list[F64] = []
    flats: list[F64] = []
    uvs: list[F64] = []
    faces: list[I64] = []
    owner: list[I64] = []
    runs: dict[tuple[str, str], I64] = {}
    base = 0
    for index, (piece, offset) in enumerate(zip(pieces, offsets, strict=True)):
        outline_parts = []
        cursor = 0
        starts = {}
        for segment in piece.segments:
            points = resample(segment.points, counts[(piece.name, segment.name)])
            starts[segment.name] = cursor
            outline_parts.append(points[:-1])  # the next segment starts at its last point
            cursor += len(points) - 1
        outline = np.concatenate(outline_parts)
        for segment in piece.segments:
            count = counts[(piece.name, segment.name)]
            run = (starts[segment.name] + np.arange(count)) % len(outline)
            runs[(piece.name, segment.name)] = base + run
        points, triangles = triangulate(outline, spacing)
        placed = piece.place(points)
        lo = points.min(0)
        flats.append(points - lo + offset)
        atlas = _turn(points) if turn_uv else points
        uvs.append((atlas - atlas.min(0) + offset) / side)
        positions.append(placed)
        faces.append(triangles + base)
        owner.append(np.full(len(points), index, np.int64))
        base += len(points)

    all_positions = np.concatenate(positions)
    pairs = []
    for seam in seams:
        a = runs[(seam.a, seam.a_seg)]
        b = runs[(seam.b, seam.b_seg)]
        forward = np.linalg.norm(all_positions[a] - all_positions[b], axis=1).sum()
        backward = np.linalg.norm(all_positions[a] - all_positions[b[::-1]], axis=1).sum()
        pairs.append(np.stack([a, b if forward <= backward else b[::-1]], 1))
    return FlatMesh(
        positions=all_positions,
        flat=np.concatenate(flats),
        faces=np.concatenate(faces),
        uvs=np.concatenate(uvs),
        pairs=np.concatenate(pairs).astype(np.int64) if pairs else np.zeros((0, 2), np.int64),
        piece=np.concatenate(owner),
        names=tuple(p.name for p in pieces),
        segments=runs,
        seams=tuple(seams),
        uv_metres=side,
    )


def _turn(points: F64) -> F64:
    """A quarter turn counter-clockwise (keeps outlines counter-clockwise)."""
    return np.stack([-points[:, 1], points[:, 0]], 1)


def mirror_segments(segments: Sequence[Segment]) -> list[Segment]:
    """The same outline mirrored across u = 0 (reversed, so it stays counter-clockwise)."""
    out = []
    for segment in reversed(segments):
        points = segment.points[::-1].copy()
        points[:, 0] *= -1.0
        out.append(Segment(segment.name, points))
    return out


def nearest_gap(points: F64, others: F64) -> F64:
    return cKDTree(others).query(points)[0]
