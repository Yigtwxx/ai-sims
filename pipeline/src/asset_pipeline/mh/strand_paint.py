"""Short strands of a Fab groom painted on the head skin instead of drawn as cards.

Nomad Wave Undercut is a long top over a shaved back and sides: two strand groups, 34k
strands of 2-8 cm and 37k of 2.5-14 mm. The Hair Card Generator made ~1100 cards of 1-2 cm
from the shaved group, which read on /dev/stage as patchy tufts and horizontal streaks over
bare skin. Hair that short is what Epic's buzz cut is: Unreal draws it from strands and the
web paints its `baked` head-UV map on the skin in the hair colour (`convert_painted`).

The groom's strand file (the Alembic Unreal imported, shipped beside the Fab package in
`<archive>/fab_extras/`) gives the strands themselves. The converter drops the cards made
from a painted group (a card goes with the group whose strands its vertices lie closest to)
and draws those strands, plus the root ends of the other groups, into a head-UV coverage
map of the same kind (A: coverage, strand by strand). The manifest entry then has both
`glb` (the long cards) and `painted` (the map).
"""

import zipfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numpy.typing import NDArray
from PIL import Image
from scipy.spatial import cKDTree

from asset_pipeline.mh.alembic import Curves, read_curves
from asset_pipeline.mh.geometry import closest_triangles

F64 = NDArray[np.float64]
I64 = NDArray[np.int64]

STRAND_PAINT_VERSION = "strand-paint-v1"  # bump when the painted maps change
# Unreal's groom space (centimetres, Z up) to the glTF space the card meshes are exported
# in (metres, Y up): Unreal's glTF exporter swaps Y and Z.
CM = 0.01
# Strand width where the file has none: Epic's Hair_L_HighPonytail override (0.0125 cm).
DEFAULT_WIDTH = 0.0125 * CM
MIN_WIDTH = 1e-7  # metres
ALIGN_TOLERANCE = 0.005  # metres: median distance of strand points to the card vertices
# Points of the carded groups this close to the skin are painted too: the roots under the
# long cards, so the crown whorl between them is not bare scalp.
ROOT_DEPTH = 0.004  # metres
PAINT_SIZE = 2048  # the web packs painted maps at 2048
SUPERSAMPLE = 2
# Share of the card density laid under the paint. The web doubles painted coverage
# (`PAINT_STRENGTH` in groomDensity.ts); at 0.5 Nomad's crown whorl, where no card lies
# close to the skin, still showed pink scalp between the spikes, at 1.0 one dot remains.
CARD_COVER = 1.0
MAX_UV_STEP = 0.02  # a segment longer than this in head UV crosses a seam and is skipped


class StrandPaintError(ValueError):
    """The strand file does not match the groom's cards."""


@dataclass(frozen=True)
class StrandPaint:
    style: str
    extras: str  # zip under `<archive>/fab_extras/`
    member: str  # the Alembic file in it
    groups: tuple[str, ...]  # strand groups (Alembic curve objects) painted, not carded


PAINTS: dict[str, StrandPaint] = {
    paint.style: paint
    for paint in (
        StrandPaint(
            "NomadWaveUndercut",
            extras="gr_nomadwaveundercut.zip",
            member="Gr_NomadWaveUndercut.abc",
            groups=("ShavedHair",),
        ),
    )
}


@dataclass(frozen=True)
class Strands:
    """One strand group in glTF metres."""

    name: str
    points: F64  # (P, 3)
    counts: I64  # (C,) points per strand
    widths: F64  # (P,) metres

    @property
    def segments(self) -> I64:
        """(S, 2) point indices of every segment within a strand."""
        last = np.zeros(len(self.points), dtype=bool)
        last[np.cumsum(self.counts) - 1] = True
        first = np.flatnonzero(~last)
        return np.stack([first, first + 1], axis=1)


def from_unreal(curves: Curves) -> Strands:
    """A curves object of the strand file in glTF metres; strands without a width (some Fab
    grooms store 1e-10 cm) take `DEFAULT_WIDTH`."""
    points = curves.points.astype(np.float64)[:, [0, 2, 1]] * CM
    width = curves.attributes.get("width")
    widths = (
        np.asarray(width, dtype=np.float64).reshape(-1) * CM
        if width is not None and np.size(width) == len(points)
        else np.zeros(len(points))
    )
    widths = np.where(widths > MIN_WIDTH, widths, DEFAULT_WIDTH)
    return Strands(curves.path.rsplit("/", 1)[-1], points, curves.counts.astype(np.int64), widths)


def load_strands(paint: StrandPaint, extras_root: Path) -> dict[str, Strands]:
    """The groom's strand groups by name (the simulation guides left out)."""
    source = extras_root / paint.extras
    if not source.is_file():
        raise StrandPaintError(f"{paint.style}: strand file {source} is missing")
    with zipfile.ZipFile(source) as archive:
        data = archive.read(paint.member)
    groups = {
        strands.name: strands
        for strands in (from_unreal(c) for c in read_curves(data) if "/strands/" in c.path)
    }
    missing = sorted(set(paint.groups) - groups.keys())
    if missing:
        raise StrandPaintError(f"{paint.style}: no strand group {missing} in {paint.member}")
    return groups


def card_groups(
    positions: F64, labels: I64, groups: Sequence[Strands], sample: int = 4
) -> tuple[I64, float]:
    """The group of every card (by `labels`, the card of each vertex): the group whose strand
    points most of its vertices lie closest to. Also returns the median distance of the
    strand points to the card vertices, which shows the two are in the same space."""
    trees = [cKDTree(g.points) for g in groups]
    distances = np.stack([tree.query(positions)[0] for tree in trees], axis=1)
    nearest = np.argmin(distances, axis=1)
    votes = np.zeros((labels.max() + 1, len(groups)))
    np.add.at(votes, (labels, nearest), 1)
    points = np.concatenate([g.points[::sample] for g in groups])
    spread = float(np.median(cKDTree(positions).query(points)[0]))
    return np.argmax(votes, axis=1).astype(np.int64), spread


def _splat(grid: NDArray[np.float64], x: F64, y: F64, weight: F64) -> None:
    """Bilinear splat of weights at texel coordinates (texel centres at integers + 0.5)."""
    size = grid.shape[0]
    fx, fy = x - 0.5, y - 0.5
    x0, y0 = np.floor(fx).astype(np.int64), np.floor(fy).astype(np.int64)
    tx, ty = fx - x0, fy - y0
    for dx, dy, w in (
        (0, 0, (1 - tx) * (1 - ty)),
        (1, 0, tx * (1 - ty)),
        (0, 1, (1 - tx) * ty),
        (1, 1, tx * ty),
    ):
        cols, rows = x0 + dx, y0 + dy
        inside = (cols >= 0) & (cols < size) & (rows >= 0) & (rows < size)
        np.add.at(grid, (rows[inside], cols[inside]), (weight * w)[inside])


def paint_strands(
    head_positions: F64,
    head_triangles: I64,
    corner_uvs: F64,
    painted: Sequence[Strands],
    rooted: Sequence[Strands],
    size: int = PAINT_SIZE,
) -> NDArray[np.uint8]:
    """A head-UV coverage map (A, 0..255; RGB zero) of the `painted` strands and of the
    points of the `rooted` strands within `ROOT_DEPTH` of the skin.

    Every strand point takes the head UV of its closest skin point (`corner_uvs`: the UVs
    of each triangle's corners, so a triangle on a UV seam keeps its own island). Each
    segment is drawn in UV as a line of the strand's width, scaled by the segment's own
    texels per metre, at twice the size; the ink (strand area per texel) becomes coverage
    `1 - exp(-ink)`, so overlapping strands saturate the way stacked hair hides skin."""
    high = size * SUPERSAMPLE
    ink = np.zeros((high, high))
    for strands, keep_all in [*((s, True) for s in painted), *((s, False) for s in rooted)]:
        triangle, bary, distance = closest_triangles(strands.points, head_positions, head_triangles)
        uv = np.einsum("pk,pkj->pj", bary, corner_uvs[triangle]) * high
        segments = strands.segments
        if not keep_all:
            near = distance <= ROOT_DEPTH
            segments = segments[near[segments[:, 0]] & near[segments[:, 1]]]
        a, b = uv[segments[:, 0]], uv[segments[:, 1]]
        length_px = np.linalg.norm(b - a, axis=1)
        length_m = np.linalg.norm(
            strands.points[segments[:, 1]] - strands.points[segments[:, 0]], axis=1
        )
        usable = (length_px > 0) & (length_px <= MAX_UV_STEP * high) & (length_m > 0)
        segments, a, b = segments[usable], a[usable], b[usable]
        length_px, length_m = length_px[usable], length_m[usable]
        width = 0.5 * (strands.widths[segments[:, 0]] + strands.widths[segments[:, 1]])
        width_px = width * length_px / length_m
        steps = np.maximum(np.ceil(length_px * 2).astype(np.int64), 1)  # <= half a texel
        owner = np.repeat(np.arange(len(steps)), steps)
        step = np.arange(len(owner)) - np.repeat(np.cumsum(steps) - steps, steps)
        t = (step + 0.5) / steps[owner]  # sample midpoints along the segment
        at = a[owner] + (b[owner] - a[owner]) * t[:, None]
        _splat(ink, at[:, 0], at[:, 1], (width_px * length_px / steps)[owner])
    coverage = 1.0 - np.exp(-ink)
    image = Image.fromarray(coverage.astype(np.float32))
    small = np.asarray(image.resize((size, size), Image.Resampling.BOX))
    out = np.zeros((size, size, 4), dtype=np.uint8)
    out[..., 3] = np.round(np.clip(small, 0.0, 1.0) * 255.0).astype(np.uint8)
    return out


def split_groups(
    groups: Mapping[str, Strands], paint: StrandPaint
) -> tuple[list[Strands], list[Strands]]:
    """(painted groups, carded groups), each in name order."""
    names = sorted(groups)
    return (
        [groups[n] for n in names if n in paint.groups],
        [groups[n] for n in names if n not in paint.groups],
    )


def under_cards(paint: NDArray[np.uint8], card_density: NDArray[np.uint8]) -> NDArray[np.uint8]:
    """The painted map joined with the smooth cover of the cards (`density_from_cards`, A),
    scaled by `CARD_COVER`: hair seen through the gaps of the long cards, as the density
    of a card groom tints it."""
    size = paint.shape[0]
    cover = Image.fromarray(card_density[..., 3]).resize((size, size), Image.Resampling.BILINEAR)
    out = paint.copy()
    lifted = np.round(np.asarray(cover, dtype=np.float32) * CARD_COVER).astype(np.uint8)
    out[..., 3] = np.maximum(out[..., 3], lifted)
    return out
