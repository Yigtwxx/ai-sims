"""Pencil skirt drafted to the outfit-base body.

Each row is the body's cross-section (both legs and the hips under one convex hull) grown
outward: by a few millimetres from the waist down to the hips, and below the hips by as much
as keeps the circumference falling straight to the hem with a small taper, so the skirt
does not hug the thighs. Pieces: a front panel (side seam to side seam) and two back
halves meeting at a centre-back seam that stays open over the slit. The waistband is the
top rows of the same pieces, pinned in the simulation.
"""

from dataclasses import dataclass

import numpy as np

from asset_pipeline.garments.body import BaseBody, Landmarks, landmarks, offset_hull, section
from asset_pipeline.garments.pack import GarmentLines
from asset_pipeline.garments.pattern import (
    F64,
    GarmentMesh,
    GridPanel,
    Weld,
    assemble,
    boundary_path,
    ray_hit,
    resample,
)

FRONT = "front"
BACK_LEFT = "back_left"  # the wearer's left (+x)
BACK_RIGHT = "back_right"


@dataclass(frozen=True)
class SkirtSpec:
    name: str = "AS_PencilSkirt"
    hem_below_knee: float = 0.02  # metres
    waistband: float = 0.035
    slit: float = 0.15  # open centre-back seam above the hem
    waist_clearance: float = 0.003  # radial ease at the waist
    hip_clearance: float = 0.006  # radial ease at the hips
    hem_taper: float = 0.06  # hem circumference = hip circumference minus this
    row: float = 0.01  # row spacing
    half_front_cols: int = 25  # columns from a side seam to the centre front
    back_cols: int = 25  # columns from a side seam to the centre back
    smooth: int = 2  # [1, 2, 1] passes along the rows


@dataclass(frozen=True, eq=False)
class Draft:
    mesh: GarmentMesh
    landmarks: Landmarks
    heights: F64  # (R,) row heights, hem first
    waist_row: int  # first waistband row
    slit_rows: int  # rows of the open centre-back slit, from the hem


def clearance(
    height: float,
    perimeter: float,
    marks: Landmarks,
    hem: float,
    hip_perimeter: float,
    spec: SkirtSpec,
) -> float:
    """Radial distance from the body's hull at `height`."""
    if height >= marks.hip:
        span = max(marks.waist - marks.hip, 1e-6)
        share = float(np.clip((marks.waist - height) / span, 0.0, 1.0))
        return spec.waist_clearance + share * (spec.hip_clearance - spec.waist_clearance)
    share = float(np.clip((marks.hip - height) / max(marks.hip - hem, 1e-6), 0.0, 1.0))
    target = hip_perimeter + 2 * np.pi * spec.hip_clearance - spec.hem_taper * share
    return max(spec.hip_clearance, (target - perimeter) / (2 * np.pi))


def _row(hull: F64, spec: SkirtSpec) -> tuple[F64, F64, F64, F64, F64, F64]:
    """Points around one grown section (x, z): front (right side seam to left side seam
    through the centre front), back left and back right (side seam to centre back), each
    with its arc lengths."""
    z_mid = 0.5 * (hull[:, 1].min() + hull[:, 1].max())
    origin = np.array([0.0, z_mid])
    right = ray_hit(hull, origin, np.array([-1.0, 0.0]))
    left = ray_hit(hull, origin, np.array([1.0, 0.0]))
    front = ray_hit(hull, origin, np.array([0.0, 1.0]))
    back = ray_hit(hull, origin, np.array([0.0, -1.0]))

    def arc(start: tuple[F64, int, float], end: tuple[F64, int, float], high: bool) -> F64:
        paths = [boundary_path(hull, start, end, forward) for forward in (True, False)]
        mean_z = [p[:, 1].mean() for p in paths]
        return paths[int(np.argmax(mean_z) if high else np.argmin(mean_z))]

    n = spec.half_front_cols
    fr, fr_arc = resample(arc(right, front, high=True), n)
    fl, fl_arc = resample(arc(front, left, high=True), n)
    front_points = np.concatenate([fr, fl[1:]])
    front_arc = np.concatenate([fr_arc - fr_arc[-1], fl_arc[1:]])  # 0 at the centre front
    bl, bl_arc = resample(arc(left, back, high=False), spec.back_cols)
    br, br_arc = resample(arc(right, back, high=False), spec.back_cols)
    return front_points, front_arc, bl, bl_arc - bl_arc[-1], br, br_arc - br_arc[-1]


def _smooth_rows(points: F64, passes: int) -> F64:
    """[1, 2, 1] along the rows (x and z only), ends fixed."""
    out = points.copy()
    for _ in range(passes):
        inner = 0.25 * out[:-2] + 0.5 * out[1:-1] + 0.25 * out[2:]
        out[1:-1, :, 0] = inner[:, :, 0]
        out[1:-1, :, 2] = inner[:, :, 2]
    return out


def _keep_outside(points: F64, rings: list[F64]) -> F64:
    """Put nodes that smoothing pulled inside their row's grown section back on its edge,
    along the ray from the section's centre (rows change fast where the legs meet)."""
    out = points.copy()
    for r, ring in enumerate(rings):
        center = ring.mean(0)
        edges = np.roll(ring, -1, 0) - ring
        for c in range(out.shape[1]):
            p = out[r, c, [0, 2]]
            rel = p - ring
            # Hull is clockwise in (x, z): inside is the right of every edge.
            if (edges[:, 0] * rel[:, 1] - edges[:, 1] * rel[:, 0] < 0).all():
                hit, _, _ = ray_hit(ring, center, p - center)
                out[r, c, 0], out[r, c, 2] = hit
    return out


def _meridian(points: F64, column: int) -> F64:
    """Distance up the piece along one column, from the hem."""
    steps = np.linalg.norm(np.diff(points[:, column], axis=0), axis=1)
    return np.concatenate([[0.0], np.cumsum(steps)])


def draft_pencil_skirt(body: BaseBody, spec: SkirtSpec | None = None) -> Draft:
    spec = spec or SkirtSpec()
    marks = landmarks(body)
    hem = marks.knee - spec.hem_below_knee
    top = marks.waist + spec.waistband
    rows = round((top - hem) / spec.row) + 1
    heights = np.linspace(hem, top, rows)
    trunk = body.trunk
    hip_perimeter = section(trunk, marks.hip).perimeter

    columns: list[tuple[F64, ...]] = []
    rings: list[F64] = []
    for height in heights:
        hull = section(trunk, float(height)).hull
        perimeter = float(np.linalg.norm(np.roll(hull, -1, 0) - hull, axis=1).sum())
        grown = offset_hull(
            hull, clearance(float(height), perimeter, marks, hem, hip_perimeter, spec)
        )
        rings.append(grown)
        columns.append(_row(grown, spec))

    def lift(index: int) -> tuple[F64, F64]:
        xz = np.stack([c[index] for c in columns])  # (R, C, 2)
        points = np.stack(
            [xz[..., 0], np.broadcast_to(heights[:, None], xz.shape[:2]), xz[..., 1]], -1
        )
        smooth = _keep_outside(_smooth_rows(points, spec.smooth), rings)
        return smooth, np.stack([c[index + 1] for c in columns])

    waist_row = int(np.searchsorted(heights, marks.waist))
    slit_rows = int(np.searchsorted(heights, hem + spec.slit))
    pin = np.zeros(rows)
    pin[waist_row:] = 1.0

    panels = []
    for name, index, center in (
        (FRONT, 0, spec.half_front_cols - 1),
        (BACK_LEFT, 2, -1),
        (BACK_RIGHT, 4, -1),
    ):
        points, arcs = lift(index)
        v = _meridian(points, center)
        flat = np.stack([arcs, np.broadcast_to(v[:, None], arcs.shape)], -1)
        panels.append(
            GridPanel(name, points, flat, np.broadcast_to(pin[:, None], arcs.shape).copy())
        )

    last_front = 2 * spec.half_front_cols - 2
    last_back = spec.back_cols - 1
    welds = [
        Weld(FRONT, 0, BACK_RIGHT, 0, (0, rows)),
        Weld(FRONT, last_front, BACK_LEFT, 0, (0, rows)),
        Weld(BACK_LEFT, last_back, BACK_RIGHT, last_back, (slit_rows, rows)),
    ]
    return Draft(assemble(panels, welds), marks, heights, waist_row, slit_rows)


def skirt_lines(draft: Draft) -> GarmentLines:
    """Seams, finished edges and topstitching of the pencil skirt, in UV space."""
    uvs = draft.mesh.panel_uvs
    mm = 0.001 / draft.mesh.uv_metres  # one millimetre of fabric in UV units
    front, left, right = uvs[FRONT], uvs[BACK_LEFT], uvs[BACK_RIGHT]
    slit, waist = draft.slit_rows, draft.waist_row
    seams = [front[:, 0], front[:, -1], left[:, 0], right[:, 0]]
    seams += [left[slit:, -1], right[slit:, -1]]
    seams += [panel[waist] for panel in (front, left, right)]
    edges = [panel[0] for panel in (front, left, right)]
    edges += [panel[-1] for panel in (front, left, right)]
    edges += [left[: slit + 1, -1], right[: slit + 1, -1]]

    def inset(line: F64, toward: F64, distance: float) -> F64:
        direction = toward - line
        direction /= np.maximum(np.linalg.norm(direction, axis=1, keepdims=True), 1e-12)
        return line + direction * distance * mm

    stitches = []
    for panel in (front, left, right):
        stitches.append(inset(panel[-1], panel[-2], 3.0))  # waistband, below its top edge
        stitches.append(inset(panel[waist], panel[waist + 1], 3.0))  # waistband, above the join
    for panel in (left, right):
        stitches.append(inset(panel[: slit + 1, -1], panel[: slit + 1, -2], 6.0))  # slit facing
    return GarmentLines(seams=seams, edges=edges, stitches=stitches)
