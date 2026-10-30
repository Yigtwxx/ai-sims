"""Shorts drafted to the outfit-base body as a flat pattern.

Four pieces, a front and a back for each leg, sewn at the side seams, the inseams and the
crotch seam (centre front and centre back). Widths come from the body's girths (the hips
under one hull, each thigh under its own) plus ease; the crotch extensions reach between
the legs. Each piece starts wrapped on rings round the body: above the crotch the hips,
below it its own leg, every row spread from its inner seam to its side seam, so all four
start with their seams together. The waistband is pinned where it starts.
"""

from collections.abc import Callable
from dataclasses import dataclass, replace

import numpy as np
from scipy.interpolate import PchipInterpolator

from asset_pipeline.garments import GarmentError
from asset_pipeline.garments.body import BaseBody, convex_hull, landmarks, offset_hull
from asset_pipeline.garments.flat import (
    F64,
    FlatMesh,
    Piece,
    Place,
    Seam,
    Segment,
    bezier,
    layout,
    offset_line,
    polyline,
    resample,
)
from asset_pipeline.garments.pack import GarmentLines
from asset_pipeline.garments.tee import Ring, make_ring

PIECES = ("front_l", "front_r", "back_l", "back_r")  # the wearer's left leg is +x
SECTION = 0.006  # half-height of a body slab (m)
LEG_SIDE = 0.005  # x past which skin below the crotch is the left leg's
FLAP_DROP = 0.01  # crotch extensions start this far under the crotch (m)
CROTCH_BAND = 0.07  # metres under the crotch where the hips' wrap turns into the leg's
PIN_BAND = 0.012  # metres of the waistband's top edge held where it starts


@dataclass(frozen=True)
class ShortsSpec:
    name: str
    top_below_waist: float  # rise: the waistband's top below the natural waist (m)
    inseam: float | None = None  # hem below the crotch, or
    above_knee: float | None = None  # hem above the knee joint
    top_ease: float = 0.02  # girth ease (metres of circumference)
    hip_ease: float = 0.04
    hem_ease: float = 0.05
    leg_ease: float = 0.05  # round the thigh just under the crotch
    front_share: float = 0.47  # of each girth on the front pieces
    front_extension: float = 0.045  # crotch extensions past the centre lines
    back_extension: float = 0.09
    front_crotch_depth: float = 0.07  # rise of the crotch curves above the crotch point
    back_crotch_depth: float = 0.10
    back_raise: float = 0.02  # the back's top higher at the centre back
    waistband: float = 0.035
    hem_band: float = 0.02  # turned-up hem (or a rolled cuff's height)
    spacing: float = 0.011
    gap: float = 0.004  # start of the simulation: rings outside the body
    denim: bool = False  # jeans details in the garment maps
    cut_off: bool = False  # raw, frayed hem instead of a turned-up one


DENIM_MINI_SHORTS = ShortsSpec(
    "AS_DenimMiniShorts",
    top_below_waist=0.08,
    inseam=0.045,
    top_ease=-0.01,
    hip_ease=0.0,
    hem_ease=0.05,
    denim=True,
    cut_off=True,
)
DENIM_SHORTS = ShortsSpec(
    "AS_DenimShorts",
    top_below_waist=0.05,
    above_knee=0.07,
    top_ease=0.03,
    hip_ease=0.02,
    hem_ease=0.06,
    leg_ease=0.04,
    front_extension=0.05,
    back_extension=0.1,
    front_crotch_depth=0.08,
    back_crotch_depth=0.11,
    waistband=0.04,
    hem_band=0.03,
    denim=True,
)
MINI_SHORTS = ShortsSpec(
    "AS_MiniShorts", top_below_waist=0.07, inseam=0.07, top_ease=-0.01, hip_ease=0.0, hem_ease=0.04
)


@dataclass(frozen=True)
class ShortsMeasures:
    top: float  # heights (m)
    crotch: float
    hem: float
    girth_top: float
    girth_hip: float
    girth_thigh: float  # one leg at the hem
    girth_leg: float  # one leg just under the crotch


def _slab(points: F64, height: float, band: float = SECTION) -> F64:
    return points[np.abs(points[:, 1] - height) < band]


class Sections:
    """Exact horizontal cross-sections of the body's skin (torso and legs, no arms): the
    points where triangle edges cross the height. Slabs of vertices are too sparse round
    the thighs, where their hulls jump from one height to the next."""

    def __init__(self, body: BaseBody) -> None:
        limb = body.limb if body.limb is not None else body.arm
        keep = ~limb & (np.abs(body.positions[:, 0]) < 0.3)
        triangles = body.triangles[keep[body.triangles].all(1)]
        corners = body.positions[triangles]  # (T, 3, 3): each edge from a to b
        self.a = corners.reshape(-1, 3)
        self.b = np.roll(corners, -1, axis=1).reshape(-1, 3)

    def at(self, height: float, side: float = 0.0) -> F64:
        """(x, z) points of the section; `side` > 0 keeps x > side, < 0 x < side."""
        ya, yb = self.a[:, 1], self.b[:, 1]
        cross = (ya - height) * (yb - height) <= 0.0
        cross &= ya != yb
        a, b = self.a[cross], self.b[cross]
        t = ((height - a[:, 1]) / (b[:, 1] - a[:, 1]))[:, None]
        points = (a + t * (b - a))[:, [0, 2]]
        if side > 0:
            points = points[points[:, 0] > side]
        if len(points) < 3:
            raise GarmentError(f"no body section at {height:.3f} m")
        return points

    def girth(self, height: float, side: float = 0.0) -> float:
        return _perimeter(convex_hull(self.at(height, side)))


def _perimeter(hull: F64) -> float:
    return float(np.linalg.norm(np.roll(hull, -1, 0) - hull, axis=1).sum())


def crotch_height(trunk: F64, start: float, stop: float, step: float = 0.0025) -> float:
    """Lowest height with skin at the middle (x ~ 0): where the legs join."""
    for height in np.arange(start, stop, step):
        slab = _slab(trunk, float(height), 0.004)
        if len(slab) and (np.abs(slab[:, 0]) < 0.012).any():
            return float(height)
    raise GarmentError("no crotch: the legs never join")


def measure_shorts(body: BaseBody, spec: ShortsSpec) -> ShortsMeasures:
    limb = body.limb if body.limb is not None else body.arm
    trunk = body.positions[~limb & (np.abs(body.positions[:, 0]) < 0.3)]
    marks = landmarks(body)
    crotch = crotch_height(trunk, marks.knee, marks.hip)
    top = marks.waist - spec.top_below_waist
    if spec.inseam is not None:
        hem = crotch - spec.inseam
    elif spec.above_knee is not None and "calf_l" in body.joints:
        hem = float(body.joints["calf_l"][1]) + spec.above_knee
    else:
        raise GarmentError(f"{spec.name}: no hem height")
    sections = Sections(body)
    hip = max(sections.girth(float(h)) for h in np.arange(crotch + 0.02, top, 0.01))
    return ShortsMeasures(
        top=top,
        crotch=crotch,
        hem=hem,
        girth_top=sections.girth(top),
        girth_hip=hip,
        girth_thigh=sections.girth(hem, LEG_SIDE),
        girth_leg=sections.girth(crotch - 0.015, LEG_SIDE),
    )


@dataclass(frozen=True, eq=False)
class LegPattern:
    """One piece, u growing from the inner seams (centre line, crotch, inseam) to the side
    seam, v up from the hem."""

    top_width: float
    hip_width: float
    hem_width: float
    leg_width: float  # inner seam to side seam at the crotch
    extension: float
    crotch_depth: float
    crotch_v: float
    hip_v: float
    top_v: float
    raise_: float  # top edge higher at the centre line

    def segments(self) -> list[Segment]:
        # The side seam comes in below the hips so the leg is its own width at the crotch
        # (the extension reaches the rest of the way round).
        outer_crotch = min(self.leg_width - self.extension, self.hip_width)
        outer_hem = outer_crotch - 0.005
        inner_hem = outer_hem - self.hem_width
        side = PchipInterpolator(
            [0.0, self.crotch_v, self.hip_v, self.top_v],
            [outer_hem, outer_crotch, self.hip_width, self.top_width],
        )
        v = np.linspace(0.0, self.top_v, 24)
        side_line = np.stack([side(v), v], 1)
        top = polyline((self.top_width, self.top_v), (0.0, self.top_v + self.raise_))
        crotch_top = self.crotch_v + self.crotch_depth
        centre = np.concatenate(
            [
                polyline((0.0, self.top_v + self.raise_), (0.0, crotch_top))[:-1],
                bezier(
                    np.array([0.0, crotch_top]),
                    np.array([0.0, self.crotch_v + 0.35 * self.crotch_depth]),
                    np.array([-0.5 * self.extension, self.crotch_v]),
                    np.array([-self.extension, self.crotch_v]),
                ),
            ]
        )
        return [
            Segment("hem", polyline((inner_hem, 0.0), (outer_hem, 0.0))),
            Segment("side", side_line),
            Segment("top", top),
            Segment("centre", centre),
            Segment("inseam", polyline((-self.extension, self.crotch_v), (inner_hem, 0.0))),
        ]


def _edges(segments: list[Segment]) -> tuple[PchipInterpolator, PchipInterpolator]:
    """u of the inner seams and of the side seam by v."""
    by = {s.name: s.points for s in segments}
    inner = np.concatenate([by["inseam"][::-1], by["centre"][::-1][1:]])
    order = np.argsort(inner[:, 1], kind="stable")
    v, keep = np.unique(inner[order, 1], return_index=True)
    inner_fn = PchipInterpolator(v, inner[order][keep, 0], extrapolate=True)
    side = by["side"]
    return inner_fn, PchipInterpolator(side[:, 1], side[:, 0], extrapolate=True)


def _flip(segments: list[Segment]) -> list[Segment]:
    """Mirror across u = 0 and reverse, so the outline stays counter-clockwise."""
    out = []
    for segment in reversed(segments):
        points = segment.points[::-1].copy()
        points[:, 0] *= -1.0
        out.append(Segment(segment.name, points))
    return out


def _hip_along(ring: Ring, t: F64, f: F64, front: bool, left: bool) -> F64:
    """Centre front (or back) of the hips to the side seam, which sits `f` of the way round
    from the centre front to the centre back (the front pieces' share of the row)."""
    p, back = ring.perimeter, ring.back
    if front:
        s = t * f * back if left else -t * f * (p - back)
    else:
        s = back - t * (1 - f) * back if left else back + t * (1 - f) * (p - back)
    return ring.at(s)


def _leg_along(ring: Ring, t: F64, f: F64, front: bool, left: bool) -> F64:
    """A leg's inner side (facing the other leg) round its front (or back) to the side
    seam, `f` of the ring round the front; ring arcs start at the front, toward +x."""
    p, plus, minus = ring.perimeter, ring.side(True), ring.side(False)
    start = minus if left else plus
    span = (f if front else 1 - f) * p
    forward = front == left  # the left leg's front runs on through arc 0
    return ring.at(start + t * span if forward else start - t * span)


def _on_rings(
    rings: list[Ring], y: F64, t: F64, f: F64, along: Callable[[Ring, F64, F64], F64]
) -> F64:
    """(x, z) at height `y` and share `t` of each row, blended between the two rings."""
    heights = np.array([r.height for r in rings])
    k = np.clip(np.searchsorted(heights, y) - 1, 0, len(rings) - 2)
    w = np.clip((y - heights[k]) / (heights[k + 1] - heights[k]), 0.0, 1.0)
    out = np.empty((len(y), 2))
    for index in np.unique(k):
        sel = k == index
        a, b = rings[index], rings[index + 1]
        out[sel] = (1 - w[sel])[:, None] * along(a, t[sel], f[sel]) + w[sel][:, None] * along(
            b, t[sel], f[sel]
        )
    return out


def leg_place(
    hips: list[Ring],
    legs: list[Ring],
    crotch: float,
    hem: float,
    inner: PchipInterpolator,
    outer: PchipInterpolator,
    front: bool,
    left: bool,
    mirrored: bool,
    crotch_z: float,
    crotch_depth: float,
    hip_share: Callable[[F64], F64],
    leg_share: Callable[[F64], F64],
) -> Place:
    """Two ways to wrap a row, blended over CROTCH_BAND under the crotch:
    - round the hips: from the centre line (u = 0) to the side seam, the crotch
      extension or inseam part past the centre line (u < 0) folded under the body to the
      middle of the crotch (the chord of its convex front or back, so it starts outside);
    - round its own leg: from the inseam to the side seam.
    Above the crotch rows wrap the hips, below the band the leg."""

    def hip_along(ring: Ring, t: F64, f: F64) -> F64:
        return _hip_along(ring, t, f, front, left)

    def leg_along(ring: Ring, t: F64, f: F64) -> F64:
        return _leg_along(ring, t, f, front, left)

    def place(flat: F64) -> F64:
        u = -flat[:, 0] if mirrored else flat[:, 0]
        v = flat[:, 1]
        lo, hi = inner(v), outer(v)
        y = hem + v
        out = np.zeros((len(flat), 3))
        out[:, 1] = y
        hip_rows = y >= crotch - CROTCH_BAND
        leg_rows = y < crotch
        hip = out.copy()
        if hip_rows.any():
            t = np.clip(u[hip_rows] / np.maximum(hi[hip_rows], 1e-6), 0.0, 1.0)
            xz = _on_rings(hips, y[hip_rows], t, hip_share(v[hip_rows]), hip_along)
            hip[hip_rows, 0], hip[hip_rows, 2] = xz[:, 0], xz[:, 1]
            flap = hip_rows & (u < 0)
            if flap.any():
                # The crotch seam starts on the chord under the crotch: from the middle of
                # the crotch (its lowest row) up to the centre line at the top of the curve.
                y_flap = y[flap]
                rise = np.clip((y_flap - crotch) / crotch_depth, 0.0, 1.0)[:, None]
                bottom = np.array([0.0, crotch - FLAP_DROP, crotch_z])
                top_xz = _on_rings(
                    hips, np.full(1, crotch + crotch_depth), np.zeros(1), np.full(1, 0.5), hip_along
                )
                top = np.array([top_xz[0, 0], crotch + crotch_depth, top_xz[0, 1]])
                seam = bottom + rise * (top - bottom)
                seam[:, 1] = np.where(y_flap < crotch, y_flap - FLAP_DROP, seam[:, 1])
                share = np.clip(u[flap] / np.minimum(lo[flap], -1e-6), 0.0, 1.0)[:, None]
                hip[flap] = hip[flap] + share * (seam - hip[flap])
        leg = out.copy()
        if leg_rows.any():
            t = np.clip((u[leg_rows] - lo[leg_rows]) / np.maximum(hi - lo, 1e-6)[leg_rows], 0, 1)
            xz = _on_rings(legs, y[leg_rows], t, leg_share(v[leg_rows]), leg_along)
            leg[leg_rows, 0], leg[leg_rows, 2] = xz[:, 0], xz[:, 1]
        a = np.clip((y - (crotch - CROTCH_BAND)) / CROTCH_BAND, 0.0, 1.0)
        share = (a * a * (3.0 - 2.0 * a))[:, None]
        out = np.where(leg_rows[:, None], (1 - share) * leg + share * hip, hip)
        out[:, 1] = y
        return out

    return place


@dataclass(frozen=True, eq=False)
class ShortsDraft:
    mesh: FlatMesh
    measures: ShortsMeasures
    front: LegPattern
    back: LegPattern
    pieces: tuple[Piece, ...] = ()

    def to_uv(self, name: str, points: F64) -> F64:
        """Pattern points of a piece (as drafted, before any mirroring) in the UV atlas."""
        index = self.mesh.names.index(name)
        piece = self.pieces[index]
        mirrored = name in ("front_r", "back_l")
        pattern = points * np.array([-1.0, 1.0]) if mirrored else points
        outline_min = np.concatenate([s.points for s in piece.segments]).min(0)
        on = self.mesh.piece == index
        flat = self.mesh.flat[on]
        # flat = pattern - outline min + the piece's offset; flat -> uv is affine.
        local = pattern - outline_min + flat.min(0)
        design = np.c_[flat, np.ones(len(flat))]
        affine, *_ = np.linalg.lstsq(design, self.mesh.uvs[on], rcond=None)
        return np.c_[local, np.ones(len(local))] @ affine


def draft_shorts(body: BaseBody, spec: ShortsSpec) -> ShortsDraft:
    m = measure_shorts(body, spec)
    limb = body.limb if body.limb is not None else body.arm
    trunk = body.positions[~limb & (np.abs(body.positions[:, 0]) < 0.3)]

    def widths(share: float) -> tuple[float, float, float, float]:
        return (
            share * (m.girth_top + spec.top_ease) / 2,
            share * (m.girth_hip + spec.hip_ease) / 2,
            share * (m.girth_thigh + spec.hem_ease),
            share * (m.girth_leg + spec.leg_ease),
        )

    def pattern(share: float, extension: float, depth: float, raise_: float) -> LegPattern:
        top_w, hip_w, hem_w, leg_w = widths(share)
        return LegPattern(
            top_width=top_w,
            hip_width=hip_w,
            hem_width=hem_w,
            leg_width=leg_w,
            extension=extension,
            crotch_depth=depth,
            crotch_v=m.crotch - m.hem,
            hip_v=0.5 * (m.crotch + m.top) - m.hem,
            top_v=m.top - m.hem,
            raise_=raise_,
        )

    front = pattern(spec.front_share, spec.front_extension, spec.front_crotch_depth, 0.0)
    back = pattern(
        1 - spec.front_share, spec.back_extension, spec.back_crotch_depth, spec.back_raise
    )
    front_segments, back_segments = front.segments(), back.segments()
    front_edges, back_edges = _edges(front_segments), _edges(back_segments)

    # Rings: the hips grown to the pieces' row widths (so the seams start together), each
    # leg grown to its front and back widths below the crotch.
    def row(pattern_edges: tuple[PchipInterpolator, PchipInterpolator], v: float) -> float:
        inner, outer = pattern_edges
        return float(outer(v) - inner(v))

    top = m.top + spec.back_raise + 0.01
    hips, legs = [], []
    sections = Sections(body)
    for height in np.arange(m.hem - 0.01, top, 0.005):
        v = float(height - m.hem)
        if height >= m.crotch - CROTCH_BAND - 0.005:
            # Round the hips from the centre lines (the extensions fold under).
            width = float(front_edges[1](v) + back_edges[1](v))
            hull = convex_hull(sections.at(float(height)))
            grow = max(spec.gap, (2 * width - _perimeter(hull)) / (2 * np.pi))
            hips.append(make_ring(offset_hull(hull, grow, 48), float(height)))
        if height < m.crotch + 0.005:
            width = row(front_edges, v) + row(back_edges, v)
            hull = convex_hull(sections.at(float(height), LEG_SIDE))
            grow = max(spec.gap, (width - _perimeter(hull)) / (2 * np.pi))
            legs.append(make_ring(offset_hull(hull, grow, 48), float(height)))

    def hip_share(v: F64) -> F64:
        front_w, back_w = front_edges[1](v), back_edges[1](v)
        return front_w / (front_w + back_w)

    def leg_share(v: F64) -> F64:
        front_w = front_edges[1](v) - front_edges[0](v)
        back_w = back_edges[1](v) - back_edges[0](v)
        return front_w / (front_w + back_w)

    middle = _slab(trunk, m.crotch + 0.004, 0.006)
    middle = middle[np.abs(middle[:, 0]) < 0.02]
    crotch_z = float(np.median(middle[:, 2])) if len(middle) else 0.0
    mirror = np.array([-1.0, 1.0])
    right_legs = [
        make_ring(r.points * mirror, r.height) for r in legs
    ]  # the right leg mirrors the left

    def piece(name: str, front_piece: bool, left: bool) -> Piece:
        segments = front_segments if front_piece else back_segments
        edges = front_edges if front_piece else back_edges
        # Seen from outside, u grows to the viewer's right: toward +x on the front of the
        # left leg and the back of the right one.
        mirrored = front_piece != left
        outline = _flip(segments) if mirrored else segments
        place = leg_place(
            hips,
            legs if left else right_legs,
            m.crotch,
            m.hem,
            edges[0],
            edges[1],
            front_piece,
            left,
            mirrored,
            crotch_z,
            (spec.front_crotch_depth if front_piece else spec.back_crotch_depth),
            hip_share,
            leg_share,
        )
        return Piece(name, tuple(outline), place)

    pieces = [
        piece("front_l", True, True),
        piece("front_r", True, False),
        piece("back_l", False, True),
        piece("back_r", False, False),
    ]
    seams = [
        Seam("front_l", "side", "back_l", "side"),
        Seam("front_r", "side", "back_r", "side"),
        Seam("front_l", "inseam", "back_l", "inseam"),
        Seam("front_r", "inseam", "back_r", "inseam"),
        Seam("front_l", "centre", "front_r", "centre"),
        Seam("back_l", "centre", "back_r", "centre"),
    ]
    mesh = layout(pieces, seams, spec.spacing)
    # The waistband holds the shorts up: pinned where it starts.
    v = mesh.positions[:, 1] - m.hem
    band = np.clip((v - (m.top - m.hem - PIN_BAND)) / (0.5 * PIN_BAND), 0.0, 1.0)
    pinned = replace(mesh, pin=band)
    return ShortsDraft(pinned, m, front, back, tuple(pieces))


def shorts_lines(draft: ShortsDraft, spec: ShortsSpec) -> GarmentLines:
    """Seams, finished edges, the waistband and hem stitching, in UV space; denim adds
    double topstitching, faded seams, front pockets, a fly, a back yoke and patch pockets,
    and a cut-off (frayed) or turned-up hem."""
    mesh = draft.mesh
    uv = mesh.uvs
    mm = 0.001 / mesh.uv_metres
    seams, edges, stitches, fades, frays = [], [], [], [], []
    for key, vertices in mesh.segments.items():
        line = uv[vertices]
        if mesh.sewn(*key):
            seams.append(line)
            if spec.denim:
                stitches.append(_inset(line, 1.8 * mm))
                fades.append(line)
        else:
            edges.append(line)
    for name in PIECES:
        top = uv[mesh.segments[(name, "top")]]
        seams.append(_inset(top, spec.waistband * 1000 * mm))
        stitches.append(_inset(top, 2.5 * mm))
        stitches.append(_inset(top, (spec.waistband * 1000 - 2.5) * mm))
        hem = uv[mesh.segments[(name, "hem")]]
        if spec.cut_off:
            fades.append(hem)
            frays.extend(_fringe(hem, mm))
        else:
            stitches.append(_inset(hem, spec.hem_band * 1000 * mm))
            if spec.denim:
                fades.append(hem)
                seams.append(_inset(hem, 2 * spec.hem_band * 1000 * mm))  # the cuff's fold
    if spec.denim:
        for name, front in (
            ("front_l", True),
            ("front_r", True),
            ("back_l", False),
            ("back_r", False),
        ):
            pattern = draft.front if front else draft.back
            for line, kind in _denim_details(pattern, spec, front, name == "front_l"):
                at = draft.to_uv(name, line)
                if kind == "edge":
                    edges.append(at)
                else:
                    seams.append(at)
                    fades.append(at)
                stitches.append(_inset(at, 2.0 * mm))
                stitches.append(_inset(at, 7.0 * mm))
    return GarmentLines(seams=seams, edges=edges, stitches=stitches, fades=fades, frays=frays)


def _denim_details(
    pattern: LegPattern, spec: ShortsSpec, front: bool, fly: bool
) -> list[tuple[F64, str]]:
    """Pattern-space lines of a jeans cut: front pocket openings and the fly's J, a back
    yoke and patch pockets."""
    top = pattern.top_v
    band = spec.waistband
    out: list[tuple[F64, str]] = []
    if front:
        depth = min(0.08, 0.35 * (top - pattern.crotch_v))
        start = np.array([pattern.top_width - 0.095, top])
        end = np.array([pattern.top_width + 0.002, top - depth])
        out.append(
            (
                bezier(
                    start, start + np.array([0.005, -0.6 * depth]), end - np.array([0.04, 0.0]), end
                ),
                "seam",
            )
        )
        if fly:
            low = max(pattern.crotch_v + pattern.crotch_depth, top - 0.16)
            out.append(
                (
                    np.concatenate(
                        [
                            polyline((0.035, top - band), (0.035, low + 0.03))[:-1],
                            bezier(
                                np.array([0.035, low + 0.03]),
                                np.array([0.035, low + 0.005]),
                                np.array([0.02, low]),
                                np.array([0.0, low - 0.005]),
                            ),
                        ]
                    ),
                    "stitch",
                )
            )
        return out
    yoke_low, yoke_high = top - 0.085, top - 0.045
    out.append((polyline((0.0, yoke_low), (pattern.top_width, yoke_high)), "seam"))
    width = min(0.14, 0.55 * pattern.top_width)
    middle = 0.5 * pattern.top_width + 0.01
    pocket_top = yoke_low - 0.01 + 0.5 * (yoke_high - yoke_low)
    left, right = middle - width / 2, middle + width / 2
    bottom = pocket_top - min(0.15, 0.6 * (top - pattern.crotch_v - 0.05))
    out.append(
        (
            polyline(
                (left, pocket_top),
                (left + 0.004, bottom + 0.025),
                (middle, bottom),
                (right - 0.004, bottom + 0.025),
                (right, pocket_top),
            ),
            "edge",
        )
    )
    return out


def _fringe(hem: F64, mm: float) -> list[F64]:
    """Loose weft threads along a cut-off hem: short strokes into the cloth from the edge,
    one every ~1.3 mm, 2-9 mm long (a fixed pattern, so the maps reproduce)."""
    length = float(np.linalg.norm(np.diff(hem, axis=0), axis=1).sum())
    count = max(2, round(length / (1.3 * mm)))
    base = resample(hem, count)
    inward = offset_line(base, 1.0) - base
    rng = np.random.default_rng(7)
    reach = rng.uniform(2.0, 9.0, count) * mm
    tilt = rng.uniform(-0.25, 0.25, count)
    along = np.gradient(base, axis=0)
    along /= np.maximum(np.linalg.norm(along, axis=1, keepdims=True), 1e-12)
    tips = base + (inward + tilt[:, None] * along) * reach[:, None]
    return [np.stack([a, b]) for a, b in zip(base, tips, strict=True)]


def _inset(line: F64, distance: float) -> F64:
    return offset_line(resample(line, max(len(line), 2)), distance)
