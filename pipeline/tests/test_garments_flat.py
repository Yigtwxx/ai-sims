import numpy as np
import pytest

from asset_pipeline.garments import GarmentError
from asset_pipeline.garments.flat import (
    Piece,
    Seam,
    Segment,
    layout,
    offset_line,
    polyline,
    resample,
    triangulate,
)
from asset_pipeline.garments.pack import garment_maps
from asset_pipeline.garments.tee import (
    Ring,
    TorsoPattern,
    _cap_height,
    _outline,
    _sleeve,
    make_ring,
    surface_length,
)


def area(points, triangles):
    p = points[triangles]
    e1, e2 = p[:, 1] - p[:, 0], p[:, 2] - p[:, 0]
    return 0.5 * (e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0])


def square(side, origin=(0.0, 0.0), name="sq"):
    x0, y0 = origin
    return [
        Segment("bottom", polyline((x0, y0), (x0 + side, y0))),
        Segment("right", polyline((x0 + side, y0), (x0 + side, y0 + side))),
        Segment("top", polyline((x0 + side, y0 + side), (x0, y0 + side))),
        Segment("left", polyline((x0, y0 + side), (x0, y0))),
    ]


def test_triangulate_covers_the_outline_counter_clockwise():
    outline = resample(
        np.array([[0, 0], [0.3, 0], [0.3, 0.2], [0.15, 0.1], [0, 0.2], [0, 0]], float), 60
    )[:-1]
    points, triangles = triangulate(outline, 0.02)
    # The outline comes first, in order; every triangle is counter-clockwise and the
    # triangles tile the notched shape (0.06 - 0.015 m^2).
    assert np.allclose(points[: len(outline)], outline)
    assert (area(points, triangles) > 0).all()
    assert area(points, triangles).sum() == pytest.approx(0.06 - 0.015, rel=0.02)


def test_triangulate_drops_slivers_along_straight_edges():
    outline = resample(np.array([[0, 0], [0.4, 0], [0.4, 0.1], [0, 0.1], [0, 0]], float), 101)[:-1]
    _, triangles = triangulate(outline, 0.012)
    edges = np.sort(
        np.concatenate([triangles[:, [0, 1]], triangles[:, [1, 2]], triangles[:, [2, 0]]]), 1
    )
    _, counts = np.unique(edges, axis=0, return_counts=True)
    assert counts.max() <= 2  # no edge shared by more than two triangles


def place_flat(flat):
    return np.c_[flat[:, 0], flat[:, 1], np.zeros(len(flat))]


def test_layout_pairs_seams_by_where_the_pieces_start():
    a = Piece("a", tuple(square(0.1)), place_flat)
    # `b` starts right of `a`, its left edge on `a`'s right edge but running down.
    b = Piece("b", tuple(square(0.1, (0.1, 0.0))), place_flat)
    mesh = layout([a, b], [Seam("a", "right", "b", "left")], 0.02)
    gaps = np.linalg.norm(mesh.positions[mesh.pairs[:, 0]] - mesh.positions[mesh.pairs[:, 1]], 1)
    assert len(mesh.pairs) == 6  # 0.1 m at 0.02 m: six points a side
    assert gaps.max() == pytest.approx(0.0, abs=1e-9)
    assert mesh.sewn("a", "right") and mesh.sewn("b", "left")
    assert not mesh.sewn("a", "left")
    # Corners join: the seam's ends are groups of two.
    assert sorted(len(g) for g in mesh.welds()) == [2] * 6


def test_layout_gives_both_sides_of_a_seam_the_same_count():
    short = Piece("s", tuple(square(0.05)), place_flat)
    long = Piece("l", tuple(square(0.2, (0.3, 0.0))), place_flat)
    mesh = layout([short, long], [Seam("s", "top", "l", "bottom")], 0.01)
    assert len(mesh.segments[("s", "top")]) == len(mesh.segments[("l", "bottom")]) == 21


def test_layout_rest_shape_keeps_the_pattern():
    piece = Piece("p", tuple(square(0.1)), lambda flat: place_flat(flat) * 2.0)
    mesh = layout([piece], [], 0.02)
    rest = mesh.to_json()["rest"]
    # The rest shape is the flat piece (x, 0, y), wherever it was placed.
    assert np.ptp(np.array(rest)[:, 0]) == pytest.approx(0.1)
    assert np.ptp(mesh.positions[:, 0]) == pytest.approx(0.2)


def test_layout_rejects_repeated_names():
    piece = Piece("p", tuple(square(0.1)), place_flat)
    with pytest.raises(GarmentError):
        layout([piece, piece], [], 0.02)


def test_offset_line_moves_into_a_counter_clockwise_outline():
    bottom = np.array([[0.0, 0.0], [1.0, 0.0]])
    assert np.allclose(offset_line(bottom, 0.1)[:, 1], 0.1)


def test_tee_outline_closes_and_mirrors():
    pattern = TorsoPattern(0.27, 0.21, 0.25, 0.22, 0.35, 0.2, 0.56, 0.08, 0.65, 0.09)
    segments = _outline(pattern, ("l", "r"))
    names = [s.name for s in segments]
    assert names == [
        "hem",
        "side_l",
        "arm_l",
        "shoulder_l",
        "neck",
        "shoulder_r",
        "arm_r",
        "side_r",
    ]
    for a, b in zip(segments, segments[1:] + segments[:1], strict=True):
        assert np.allclose(a.points[-1], b.points[0])
    left = {s.name: s.length for s in segments}
    assert left["arm_l"] == pytest.approx(left["arm_r"])
    outline = np.concatenate([s.points[:-1] for s in segments])
    x, y = outline[:, 0], outline[:, 1]
    assert 0.5 * np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y) > 0  # counter-clockwise


def test_sleeve_cap_height_matches_the_armhole():
    height = _cap_height(0.36, 0.08, 0.22)
    cap = _sleeve("s", 0.36, 0.34, 0.08, height)[2]
    assert cap.length == pytest.approx(0.22, abs=1e-4)


def test_ring_runs_from_the_centre_front_toward_plus_x():
    a = np.linspace(0, 2 * np.pi, 64, endpoint=False)
    circle = np.stack([0.2 * np.cos(a), 0.1 * np.sin(a)], 1)
    ring = make_ring(circle, 1.0)
    assert isinstance(ring, Ring)
    assert np.allclose(ring.points[0], [0.0, 0.1], atol=1e-3)
    assert ring.points[5, 0] > 0
    assert ring.side(True) == pytest.approx(ring.perimeter / 4, rel=0.02)
    assert ring.back == pytest.approx(ring.perimeter / 2, rel=0.02)


def test_surface_length_goes_over_the_top():
    # A box 0.2 deep from y = 0 to 1 at x = 0 under a pitched roof peaking 5 cm higher at
    # z = 0: the front path is 1 up plus one roof slope.
    y = np.linspace(0, 1, 50)
    sides = [np.stack([np.zeros_like(y), y, np.full_like(y, zz)], 1) for zz in (-0.1, 0.1)]
    z = np.linspace(-0.1, 0.1, 21)
    roof = np.stack([np.zeros_like(z), 1.05 - 0.5 * np.abs(z), z], 1)
    points = np.concatenate([*sides, roof])
    expected = 1.0 + np.hypot(0.1, 0.05)
    assert surface_length(points, 0.0, 0.0, True) == pytest.approx(expected, abs=1e-6)


def test_ribs_darken_the_occlusion():
    from asset_pipeline.garments.pack import GarmentLines

    plain = garment_maps(GarmentLines(), 1.0, size=64)
    ribbed = garment_maps(GarmentLines(ribs=[np.array([[0.5, 0.1], [0.5, 0.9]])]), 1.0, size=64)
    assert np.asarray(ribbed["AO"])[..., 0].min() < np.asarray(plain["AO"])[..., 0].min()


def test_shorts_leg_outline_closes_counter_clockwise():
    from asset_pipeline.garments.shorts import LegPattern

    leg = LegPattern(0.19, 0.24, 0.24, 0.27, 0.045, 0.07, 0.07, 0.19, 0.375, 0.0)
    segments = leg.segments()
    assert [s.name for s in segments] == ["hem", "side", "top", "centre", "inseam"]
    for a, b in zip(segments, segments[1:] + segments[:1], strict=True):
        assert np.allclose(a.points[-1], b.points[0])
    outline = np.concatenate([s.points[:-1] for s in segments])
    x, y = outline[:, 0], outline[:, 1]
    assert 0.5 * np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y) > 0
    # The leg at the crotch is its own width: inner seam to side seam.
    side = segments[1].points
    at_crotch = np.interp(0.07, side[:, 1], side[:, 0])
    assert at_crotch + leg.extension == pytest.approx(leg.leg_width, abs=1e-3)


def test_shorts_leg_without_a_knee_keeps_its_straight_inseam():
    from asset_pipeline.garments.shorts import LegPattern

    leg = LegPattern(0.19, 0.24, 0.24, 0.27, 0.045, 0.07, 0.07, 0.19, 0.375, 0.0)
    inseam = {s.name: s.points for s in leg.segments()}["inseam"]
    assert len(inseam) == 2, f"expected a straight inseam, got {len(inseam)} points"
    assert leg.grain_u() == pytest.approx(0.5 * (2 * (0.27 - 0.045 - 0.005) - 0.24))


def test_long_leg_runs_through_the_knee_and_hangs_about_the_grain():
    from asset_pipeline.garments.shorts import LegPattern

    # A trouser front: crotch 0.75 m up the piece, knee 0.38 m, 0.21 m wide at the knee
    # and 0.19 m at the hem.
    leg = LegPattern(
        0.18, 0.23, 0.19, 0.30, 0.04, 0.07, 0.75, 0.85, 0.97, 0.0, knee_v=0.38, knee_width=0.21
    )
    segments = leg.segments()
    for a, b in zip(segments, segments[1:] + segments[:1], strict=True):
        assert np.allclose(a.points[-1], b.points[0]), f"{a.name} -> {b.name} is open"
    outline = np.concatenate([s.points[:-1] for s in segments])
    x, y = outline[:, 0], outline[:, 1]
    assert 0.5 * np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y) > 0, "not counter-clockwise"
    by = {s.name: s.points for s in segments}
    side, inseam = by["side"], by["inseam"]

    def at(line, v):
        order = np.argsort(line[:, 1])
        return float(np.interp(v, line[order, 1], line[order, 0]))

    width_at_knee = at(side, 0.38) - at(inseam, 0.38)
    assert width_at_knee == pytest.approx(0.21, abs=2e-3), f"knee width {width_at_knee}"
    hem = by["hem"]
    assert hem[-1, 0] - hem[0, 0] == pytest.approx(0.19, abs=1e-6)
    # Below the knee both seams come in evenly about the grain line.
    grain = leg.grain_u()
    assert 0.5 * (at(side, 0.38) + at(inseam, 0.38)) == pytest.approx(grain, abs=2e-3)
    assert 0.5 * (hem[0, 0] + hem[-1, 0]) == pytest.approx(grain, abs=1e-6)
    # The inseam takes most of the narrowing from the crotch to the knee.
    side_in = at(side, 0.75) - at(side, 0.38)
    inner_in = at(inseam, 0.38) - at(inseam, 0.75)
    assert inner_in > side_in > 0, f"side {side_in}, inseam {inner_in}"


def test_crotch_height_is_where_the_legs_join():
    from asset_pipeline.garments.shorts import crotch_height

    y = np.linspace(0.0, 1.0, 201)
    legs = [np.stack([np.full_like(y, sx), y, np.zeros_like(y)], 1) for sx in (-0.1, 0.1)]
    top = y[y > 0.62]
    middle = np.stack([np.zeros_like(top), top, np.zeros_like(top)], 1)
    points = np.concatenate([*legs, middle])
    assert crotch_height(points, 0.3, 0.9) == pytest.approx(0.625, abs=0.005)


@pytest.mark.parametrize("front", [True, False])
@pytest.mark.parametrize("left", [True, False])
def test_leg_wrap_splits_the_ring_by_the_front_share(front, left):
    from asset_pipeline.garments.shorts import _leg_along

    a = np.linspace(0, 2 * np.pi, 128, endpoint=False)
    ring = make_ring(np.stack([0.08 * np.cos(a), 0.08 * np.sin(a)], 1), 0.5)
    t = np.linspace(0.0, 1.0, 50)
    points = _leg_along(ring, t, np.full(50, 0.4), front, left)
    length = np.linalg.norm(np.diff(points, axis=0), axis=1).sum()
    share = 0.4 if front else 0.6
    assert length == pytest.approx(share * ring.perimeter, rel=0.03)
    # Starts on the side facing the other leg; the front path passes the front.
    assert np.sign(points[0, 0]) == (-1 if left else 1)
    assert (points[:, 1].max() > 0.07) == front


def test_band_is_one_on_the_segment_and_fades_out():
    piece = Piece("p", tuple(square(0.2)), place_flat)
    mesh = layout([piece], [], 0.02)
    band = mesh.band([("p", "bottom")], 0.02)
    y = mesh.flat[:, 1] - mesh.flat[:, 1].min()
    assert band[y < 0.005].min() == pytest.approx(1.0)
    assert band[y > 0.035].max() == pytest.approx(0.0)


def test_arm_share_follows_the_sleeves_and_fades_on_the_torso():
    from asset_pipeline.garments.flat import FlatMesh
    from asset_pipeline.garments.tee import BACK, FRONT, SLEEVE_L, SLEEVE_R, arm_share

    pieces = [
        Piece(FRONT, tuple(_named(square(0.3), {"right": "arm_l", "left": "arm_r"})), place_flat),
        Piece(
            BACK,
            tuple(_named(square(0.3, (0.4, 0.0)), {"right": "arm_r", "left": "arm_l"})),
            place_flat,
        ),
        Piece(SLEEVE_L, tuple(square(0.1, (0.8, 0.0))), place_flat),
        Piece(SLEEVE_R, tuple(square(0.1, (1.0, 0.0))), place_flat),
    ]
    mesh = layout(pieces, [], 0.02)
    assert isinstance(mesh, FlatMesh)
    share = arm_share(mesh, band=0.06)
    on = lambda name: mesh.piece == mesh.names.index(name)  # noqa: E731
    assert np.allclose(share[on(SLEEVE_L)], 1.0)
    assert np.allclose(share[on(SLEEVE_R)], -1.0)
    front = on(FRONT)
    x = mesh.flat[front, 0] - mesh.flat[front, 0].min()
    # On the front's right edge (its left armhole) the cloth follows the left arm about
    # three quarters, in the middle not at all.
    assert share[front][x > 0.299].min() == pytest.approx(20 / 27, abs=0.01)
    assert np.abs(share[front][(x > 0.12) & (x < 0.18)]).max() == pytest.approx(0.0)


def _named(segments, names):
    return [Segment(names.get(s.name, s.name), s.points) for s in segments]


def test_fill_front_and_back_fills_creases_only():
    from asset_pipeline.garments.collider import fill_front_and_back

    # A round section with a 1 cm crease in the front middle and a deep hollow at the back.
    angle = np.linspace(0, 2 * np.pi, 72, endpoint=False)
    ring = np.stack([0.1 * np.sin(angle), 0.1 * np.cos(angle)], 1)
    crease = np.abs(ring[:, 0]) < 0.015
    ring[crease & (ring[:, 1] > 0), 1] -= 0.01
    ring[crease & (ring[:, 1] < 0), 1] += 0.06
    points = np.c_[ring[:, 0], np.full(len(ring), 1.0), ring[:, 1]]
    filled = fill_front_and_back(points, lambda h: ring, np.ones(len(points), bool), 0.025)
    front = crease & (ring[:, 1] > 0)
    back = crease & (ring[:, 1] < 0)
    assert (filled[front, 2] > points[front, 2] + 0.005).all()
    assert np.allclose(filled[back], points[back])


def test_fill_front_and_back_fills_a_deep_back_cleft_with_back_reach():
    from asset_pipeline.garments.collider import fill_front_and_back

    # The same section: a 6 cm hollow at the back (the cleft of a seat) is left alone by
    # the front's 2.5 cm reach, filled with a deeper back reach; the front is unchanged.
    angle = np.linspace(0, 2 * np.pi, 72, endpoint=False)
    ring = np.stack([0.1 * np.sin(angle), 0.1 * np.cos(angle)], 1)
    crease = np.abs(ring[:, 0]) < 0.015
    ring[crease & (ring[:, 1] > 0), 1] -= 0.01
    ring[crease & (ring[:, 1] < 0), 1] += 0.06
    points = np.c_[ring[:, 0], np.full(len(ring), 1.0), ring[:, 1]]
    region = np.ones(len(points), bool)
    shallow = fill_front_and_back(points, lambda h: ring, region, 0.025)
    deep = fill_front_and_back(points, lambda h: ring, region, 0.025, back_reach=0.15)
    back = crease & (ring[:, 1] < 0)
    front = crease & (ring[:, 1] > 0)
    assert (deep[back, 2] < points[back, 2] - 0.02).all(), "the cleft is filled outward"
    assert np.allclose(deep[front], shallow[front]), "the front keeps its own reach"


def _legs_layout():
    """Four 0.1 m pieces named like the shorts', placed so y is the pattern's v."""
    pieces = [
        Piece(name, tuple(square(0.1, (0.15 * i, 0.0))), place_flat)
        for i, name in enumerate(("front_l", "front_r", "back_l", "back_r"))
    ]
    return layout(pieces, [], 0.01)


def test_leg_share_follows_each_leg_only_below_the_crotch():
    from asset_pipeline.garments.shorts import LEG_FREE, LEG_FULL, ShortsSpec, _leg_share

    crotch = 0.12
    mesh = _legs_layout()
    long_legs = ShortsSpec("t", 0.05, above_ankle=0.0, knee_ease=0.1)
    share = _leg_share(mesh, crotch, long_legs)
    assert share is not None
    y = mesh.positions[:, 1]
    left = np.isin(mesh.piece, [mesh.names.index("front_l"), mesh.names.index("back_l")])
    low, high = y < crotch - LEG_FULL, y > crotch - LEG_FREE
    assert np.allclose(share[low & left], 1.0) and np.allclose(share[low & ~left], -1.0)
    assert np.allclose(share[high], 0.0), "the seat and crotch keep their bridging weights"
    assert _leg_share(mesh, crotch, ShortsSpec("s", 0.05, inseam=0.03)) is None, "shorts"


def test_trouser_details_crease_on_the_grain_and_loops_on_the_band():
    from asset_pipeline.garments.shorts import LegPattern
    from asset_pipeline.garments.trousers import (
        LOOPS_BACK,
        LOOPS_FRONT,
        TROUSERS_FEMALE,
        trouser_details,
    )

    front = LegPattern(
        0.17, 0.25, 0.175, 0.28, 0.035, 0.06, 0.63, 0.82, 0.99, 0.0, knee_v=0.4, knee_width=0.2
    )
    back = LegPattern(
        0.2, 0.29, 0.205, 0.33, 0.09, 0.1, 0.63, 0.82, 0.99, 0.025, knee_v=0.4, knee_width=0.24
    )
    lines = trouser_details(front, TROUSERS_FEMALE, front=True, fly=True)
    crease = lines["creases"][0]
    assert np.allclose(crease[:, 0], front.grain_u()), "the crease runs down the grain line"
    assert crease[:, 1].max() < front.top_v - TROUSERS_FEMALE.waistband, "below the band"
    assert len(lines["raised"]) == len(LOOPS_FRONT)
    back_lines = trouser_details(back, TROUSERS_FEMALE, front=False, fly=False)
    # A loop per position and the welt's two lips, all inside the piece's width.
    assert len(back_lines["raised"]) == len(LOOPS_BACK) + 2
    for outline in back_lines["raised"]:
        assert outline[:, 0].min() > 0.0 and outline[:, 0].max() < back.top_width
    assert back_lines["creases"][0][:, 1].max() < back.crotch_v, "the back crease stops low"
