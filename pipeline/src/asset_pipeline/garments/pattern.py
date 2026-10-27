"""Pattern pieces as grids wrapped around the body, welded at their seams into one mesh.

A panel is a rows x columns grid: `points` is where each grid node sits around the body,
`flat` the same node on the unrolled pattern piece (metres). Rows run up the body, so a
seam is a column two panels share. Blender takes the welded mesh as the cloth's rest shape;
the flat coordinates become the UVs, so woven maps run straight along the pattern.
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from numpy.typing import NDArray

from asset_pipeline.garments import GarmentError

F64 = NDArray[np.float64]
I64 = NDArray[np.int64]

UV_MARGIN = 0.02  # metres of pattern between pieces in the UV atlas


@dataclass(frozen=True, eq=False)
class GridPanel:
    name: str
    points: F64  # (R, C, 3) placed around the body
    flat: F64  # (R, C, 2) on the unrolled piece
    pin: F64 | None = None  # (R, C) cloth pin weight, 0..1

    @property
    def shape(self) -> tuple[int, int]:
        return self.points.shape[0], self.points.shape[1]


@dataclass(frozen=True)
class Weld:
    """Panel `b`'s column `b_col` is panel `a`'s column `a_col` on rows [start, stop)."""

    a: str
    a_col: int
    b: str
    b_col: int
    rows: tuple[int, int]


@dataclass(frozen=True, eq=False)
class GarmentMesh:
    positions: F64  # (V, 3)
    faces: I64  # (F, 3), outward winding
    corner_uvs: F64  # (F, 3, 2)
    pin: F64  # (V,)
    panel_uvs: dict[str, F64] = field(default_factory=dict)  # name -> (R, C, 2)
    uv_metres: float = 1.0  # pattern metres one UV unit spans

    def to_json(self) -> dict[str, Any]:
        return {
            "positions": np.round(self.positions, 6).tolist(),
            "faces": self.faces.tolist(),
            "corner_uvs": np.round(self.corner_uvs, 6).tolist(),
            "pin": np.round(self.pin, 4).tolist(),
        }


def shelf_pack(sizes: Sequence[tuple[float, float]], margin: float) -> tuple[F64, float]:
    """Offsets (N, 2) for rectangles (w, h) on shelves, and the square atlas side they fit.
    Shelves are as wide as the widest piece or the square root of the total area."""
    widest = max(w for w, _ in sizes)
    area = sum((w + margin) * (h + margin) for w, h in sizes)
    limit = max(widest + margin, float(np.sqrt(area)) * 1.1)
    offsets = np.zeros((len(sizes), 2))
    x = y = shelf = 0.0
    for i, (w, h) in enumerate(sizes):
        if x > 0 and x + w + margin > limit:
            x, y, shelf = 0.0, y + shelf, 0.0
        offsets[i] = (x + margin, y + margin)
        x += w + margin
        shelf = max(shelf, h + margin)
    used_w = max(o[0] + w for o, (w, _) in zip(offsets, sizes, strict=True)) + margin
    used_h = max(o[1] + h for o, (_, h) in zip(offsets, sizes, strict=True)) + margin
    return offsets, max(used_w, used_h)


def _quads(rows: int, cols: int) -> I64:
    r, c = np.meshgrid(np.arange(rows - 1), np.arange(cols - 1), indexing="ij")
    a = (r * cols + c).ravel()
    b, d = a + 1, a + cols
    e = d + 1
    return np.concatenate([np.stack([a, b, e], 1), np.stack([a, e, d], 1)])


def _outward(points: F64, faces: I64, center: F64) -> bool:
    """Whether the faces' normals point away from the vertical axis through `center`."""
    p = points[faces]
    normals = np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0])
    away = p.mean(1) - center
    away[:, 1] = 0.0
    return float(np.einsum("ij,ij->", normals, away)) >= 0.0


def assemble(panels: Sequence[GridPanel], welds: Sequence[Weld]) -> GarmentMesh:
    """One mesh: welded columns share vertices; each panel keeps its own UVs."""
    names = [p.name for p in panels]
    alias: dict[tuple[str, int, int], tuple[str, int, int]] = {}
    for weld in welds:
        if names.index(weld.a) >= names.index(weld.b):
            raise GarmentError(f"weld {weld}: panel {weld.a!r} must come before {weld.b!r}")
        for r in range(*weld.rows):
            alias[(weld.b, r, weld.b_col)] = (weld.a, r, weld.a_col)

    offsets, side = shelf_pack([tuple(np.ptp(p.flat.reshape(-1, 2), 0)) for p in panels], UV_MARGIN)
    center = np.concatenate([p.points.reshape(-1, 3) for p in panels]).mean(0)
    index: dict[str, I64] = {}
    positions: list[F64] = []
    pins: list[float] = []
    faces: list[I64] = []
    uvs: list[F64] = []
    panel_uvs: dict[str, F64] = {}
    count = 0
    for panel, offset in zip(panels, offsets, strict=True):
        rows, cols = panel.shape
        ids = np.empty((rows, cols), np.int64)
        pin = panel.pin if panel.pin is not None else np.zeros((rows, cols))
        for r in range(rows):
            for c in range(cols):
                target = alias.get((panel.name, r, c))
                if target is not None:
                    ids[r, c] = index[target[0]][target[1], target[2]]
                    continue
                ids[r, c] = count
                positions.append(panel.points[r, c])
                pins.append(float(pin[r, c]))
                count += 1
        index[panel.name] = ids
        local = _quads(rows, cols)
        if not _outward(panel.points.reshape(-1, 3), local, center):
            local = local[:, ::-1]
        flat = panel.flat.reshape(-1, 2)
        uv = (flat - flat.min(0) + offset) / side
        panel_uvs[panel.name] = uv.reshape(rows, cols, 2)
        faces.append(ids.ravel()[local])
        uvs.append(uv[local])
    return GarmentMesh(
        positions=np.array(positions),
        faces=np.concatenate(faces),
        corner_uvs=np.concatenate(uvs),
        pin=np.array(pins),
        panel_uvs=panel_uvs,
        uv_metres=side,
    )


# ---------------------------------------------------------------------------- polygons


def ray_hit(polygon: F64, origin: F64, direction: F64) -> tuple[F64, int, float]:
    """Where a ray from inside a convex polygon leaves it: (point, edge i from vertex i to
    i + 1, fraction along that edge)."""
    a = polygon
    b = np.roll(polygon, -1, 0)
    edge = b - a
    # Solve origin + s * direction = a + t * edge for each edge.
    cross = direction[0] * edge[:, 1] - direction[1] * edge[:, 0]
    rel = a - origin
    with np.errstate(divide="ignore", invalid="ignore"):
        s = (rel[:, 0] * edge[:, 1] - rel[:, 1] * edge[:, 0]) / cross
        t = (rel[:, 0] * direction[1] - rel[:, 1] * direction[0]) / cross
    ok = np.isfinite(s) & (s > 0) & (t >= -1e-9) & (t <= 1 + 1e-9)
    if not ok.any():
        raise GarmentError("ray does not leave the polygon")
    i = int(np.where(ok, s, np.inf).argmin())
    return origin + s[i] * direction, i, float(np.clip(t[i], 0.0, 1.0))


def boundary_path(
    polygon: F64, start: tuple[F64, int, float], end: tuple[F64, int, float], forward: bool
) -> F64:
    """The polygon boundary from `start` to `end` (ray hits), with increasing vertex index
    when `forward`, else decreasing."""
    k = len(polygon)
    (p0, i, t0), (p1, j, t1) = start, end
    points = [p0]
    if forward:
        if not (i == j and t1 >= t0):
            v = (i + 1) % k
            while True:
                points.append(polygon[v])
                if v == j:
                    break
                v = (v + 1) % k
    elif not (i == j and t1 <= t0):
        v = i
        while True:
            points.append(polygon[v])
            if v == (j + 1) % k:
                break
            v = (v - 1) % k
    points.append(p1)
    return np.array(points)


def resample(path: F64, count: int) -> tuple[F64, F64]:
    """`count` points at equal arc length along a polyline, and their arc lengths."""
    steps = np.linalg.norm(np.diff(path, axis=0), axis=1)
    arc = np.concatenate([[0.0], np.cumsum(steps)])
    targets = np.linspace(0.0, arc[-1], count)
    points = np.stack([np.interp(targets, arc, path[:, d]) for d in range(path.shape[1])], 1)
    return points, targets
