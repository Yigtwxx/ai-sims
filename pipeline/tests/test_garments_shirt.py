"""Unit tests for the long-sleeve shirt's pure pattern and placement functions.

Everything runs on synthetic geometry (hand-made patterns, stacked ellipses, a cylinder
neck); nothing here needs the MetaHuman archive or Blender.
"""

from dataclasses import replace
from functools import cache

import numpy as np
import pytest
from scipy.interpolate import PchipInterpolator
from scipy.spatial import cKDTree

from asset_pipeline.garments import GarmentError
from asset_pipeline.garments.body import convex_hull
from asset_pipeline.garments.collider import Neck
from asset_pipeline.garments.flat import F64, Piece, Place, Segment, _inside, layout, resample
from asset_pipeline.garments.shirt import (
    BUTTON_REACH,
    ArmLine,
    Collar,
    ShirtPattern,
    ShirtSpec,
    _half_ellipse_width,
    _hem,
    _neck_curve,
    _surface_hits,
    _vee_u,
    back_outline,
    bent_sleeve_place,
    button_held,
    collar_rings,
    fall_place,
    front_outline,
    hanging_rings,
    placed_by_height,
    stand_place,
    surface_profile,
)
from asset_pipeline.garments.tee import TorsoPattern, surface_length, torso_rings

MIRROR_X = np.array([-1.0, 1.0, 1.0])

# ------------------------------------------------------------------------------ helpers


def _torso(**changes: float) -> TorsoPattern:
    """A plausible back piece; the front takes a longer shoulder and neck (over the chest)."""
    base = TorsoPattern(
        hem_half=0.26,
        waist_half=0.24,
        underarm_half=0.27,
        waist_v=0.25,
        underarm_v=0.42,
        shoulder_u=0.20,
        shoulder_v=0.62,
        neck_u=0.075,
        neck_v=0.68,
        neck_drop=0.02,
    )
    return replace(base, **changes)


FRONT_TORSO = _torso(shoulder_v=0.64, neck_v=0.70)
VEE_V = FRONT_TORSO.neck_v - 0.09
DART_V = 0.34


def _front(dart: float = 0.0) -> ShirtPattern:
    return ShirtPattern(FRONT_TORSO, 0.06, 0.03, VEE_V, VEE_V - 0.08, dart, DART_V)


def _back() -> ShirtPattern:
    # As `draft_shirt` builds it: no V, no dart.
    return ShirtPattern(_torso(), 0.06, 0.0, 0.0, 0.0, 0.0, DART_V)


def _by_name(segments: tuple[Segment, ...]) -> dict[str, Segment]:
    return {s.name: s for s in segments}


def _closed(segments: tuple[Segment, ...]) -> F64:
    return np.concatenate([s.points[:-1] for s in segments])


def _shoelace(points: F64) -> float:
    x, y = points[:, 0], points[:, 1]
    return float(0.5 * np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y))


def _mirrored(points: F64) -> F64:
    """The same run seen on the other half: reversed (outline order) and u negated."""
    return points[::-1] * np.array([-1.0, 1.0])


def _curve_length(points: F64) -> float:
    return float(np.linalg.norm(np.diff(points, axis=0), axis=1).sum())


def _place_up(hem: float) -> Place:
    """Like `torso_place` without rings: (u, v) -> (u, hem + v, 0)."""

    def place(flat: F64) -> F64:
        return np.c_[flat[:, 0], hem + flat[:, 1], np.zeros(len(flat))]

    return place


# ------------------------------------------------------------------------------ outlines

FRONT_NAMES = [
    "hem",
    "side_l_low",
    "side_l_high",
    "arm_l",
    "shoulder_l",
    "neck_l",
    "vee_l",
    "vee_r",
    "neck_r",
    "shoulder_r",
    "arm_r",
    "side_r_high",
    "side_r_low",
]
FRONT_DART_NAMES = [
    "hem",
    "side_l_low",
    "dart_l_a",
    "dart_l_b",
    "side_l_high",
    "arm_l",
    "shoulder_l",
    "neck_l",
    "vee_l",
    "vee_r",
    "neck_r",
    "shoulder_r",
    "arm_r",
    "side_r_high",
    "dart_r_b",
    "dart_r_a",
    "side_r_low",
]
BACK_NAMES = [
    "hem",
    "side_r_low",
    "side_r_high",
    "arm_r",
    "shoulder_r",
    "neck",
    "shoulder_l",
    "arm_l",
    "side_l_high",
    "side_l_low",
]

OUTLINES = {
    "front": lambda: front_outline(_front()),
    "front_dart": lambda: front_outline(_front(0.025)),
    "back": lambda: back_outline(_back()),
}


@pytest.mark.parametrize(
    ("which", "names"),
    [("front", FRONT_NAMES), ("front_dart", FRONT_DART_NAMES), ("back", BACK_NAMES)],
)
def test_outline_segment_names_in_outline_order(which, names):
    got = [s.name for s in OUTLINES[which]()]
    assert got == names, f"{which}: {got}"


@pytest.mark.parametrize("which", list(OUTLINES))
def test_outline_segments_chain_end_to_start_closed(which):
    segments = OUTLINES[which]()
    for a, b in zip(segments, segments[1:] + segments[:1], strict=True):
        assert np.allclose(a.points[-1], b.points[0]), f"{which}: {a.name} -> {b.name} is open"


@pytest.mark.parametrize("which", list(OUTLINES))
def test_outline_counter_clockwise_positive_area(which):
    area = _shoelace(_closed(OUTLINES[which]()))
    assert area > 0, f"{which}: signed area {area} (clockwise)"


@pytest.mark.parametrize("which", list(OUTLINES))
def test_outline_triangulates_to_its_own_area(which):
    # A simple (non self-intersecting) outline, the dart's notch included: `layout`
    # triangulates it with every face counter-clockwise and the faces tile its area.
    segments = OUTLINES[which]()
    mesh = layout([Piece("p", segments, _place_up(0.0))], [], 0.012)
    corners = mesh.flat[mesh.faces]
    e1, e2 = corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0]
    faces = 0.5 * (e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0])
    expected = _shoelace(_closed(segments))
    assert (faces > 0).all(), f"{which}: {(faces <= 0).sum()} faces flipped"
    assert faces.sum() == pytest.approx(expected, rel=2e-3), f"{which}: {faces.sum()} m^2"


@pytest.mark.parametrize(
    ("which", "near", "far"),
    [("front", "_l", "_r"), ("front_dart", "_l", "_r"), ("back", "_r", "_l")],
)
def test_outline_far_half_mirrors_the_near_half(which, near, far):
    segments = _by_name(OUTLINES[which]())
    pairs = [
        (name, name.replace(near, far, 1))
        for name in segments
        if name.endswith(near) or f"{near}_" in name
    ]
    assert pairs, f"{which}: no {near} segments"
    for name, other in pairs:
        assert np.allclose(segments[other].points, _mirrored(segments[name].points)), (
            f"{which}: {other} does not mirror {name}"
        )


@pytest.mark.parametrize("dart", [0.0, 0.025])
def test_front_outline_vee_point_on_centre_front_at_vee_bottom(dart):
    pattern = _front(dart)
    segments = _by_name(front_outline(pattern))
    point = np.array([0.0, pattern.vee_bottom])
    assert np.allclose(segments["vee_l"].points[-1], point), segments["vee_l"].points[-1]
    assert np.allclose(segments["vee_r"].points[0], point), segments["vee_r"].points[0]
    assert np.allclose(segments["neck_l"].points[-1], [pattern.vee_u, pattern.vee_v]), (
        "the neckline ends at the stand's front end"
    )


def test_front_outline_dart_legs_sew_equal_and_lift_the_armhole_by_the_intake():
    dart = 0.025
    front, back = _by_name(front_outline(_front(dart))), _by_name(back_outline(_back()))
    for side in ("l", "r"):
        a, b = front[f"dart_{side}_a"], front[f"dart_{side}_b"]
        assert a.length == pytest.approx(b.length, abs=1e-9), f"dart_{side} legs differ"
        # The legs meet at the apex (in outline order the right half runs b, then a) ...
        ends = np.concatenate([a.points[[0, -1]], b.points[[0, -1]]])
        apex = ends[np.argmin(np.abs(ends[:, 0]))]
        mouth = ends[np.abs(ends[:, 0]) > np.abs(apex[0]) + 1e-9]
        assert (np.isclose(ends, apex).all(axis=1)).sum() == 2, f"dart_{side} legs do not meet"
        assert len(mouth) == 2, f"dart_{side}: the apex does not point in from the side seam"
        # ... and take `dart` of the side seam's height in at the mouth.
        intake = float(np.ptp(mouth[:, 1]))
        assert intake == pytest.approx(dart, abs=1e-9), f"dart_{side} mouth {intake}"
        # The side seams sewn to the back keep the back's lengths ...
        for part in ("low", "high"):
            name = f"side_{side}_{part}"
            assert front[name].length == pytest.approx(back[name].length, abs=1e-9), name
    # ... so the front's side seam climbs `dart` higher in v than the back's.
    front_span = front["side_l_high"].points[-1, 1] - front["side_l_low"].points[0, 1]
    back_span = back["side_l_high"].points[0, 1] - back["side_l_low"].points[-1, 1]
    assert front_span - back_span == pytest.approx(dart, abs=1e-9), (
        f"front {front_span}, back {back_span}"
    )


def test_hem_shirttail_lowest_at_centre_rises_to_sides_symmetric():
    pattern = _front()
    hem = _hem(pattern)
    centre = int(np.argmin(np.abs(hem[:, 0])))
    assert hem[centre, 0] == pytest.approx(0.0, abs=1e-12), "no hem point on the centre front"
    assert hem[centre, 1] == pytest.approx(0.0, abs=1e-12), f"shirttail at v = {hem[centre, 1]}"
    assert hem[:, 1].min() == pytest.approx(0.0, abs=1e-12), "something hangs below the tail"
    assert np.allclose(hem[[0, -1], 1], pattern.rise), f"side ends at {hem[[0, -1], 1]}"
    assert np.allclose(hem[[0, -1], 0], [-pattern.torso.hem_half, pattern.torso.hem_half])
    assert np.allclose(hem, _mirrored(hem)), "the hem is not symmetric about the centre"
    half = hem[centre:, 1]
    assert (np.diff(half) >= 0).all(), "the hem does not rise steadily to the side"


# ------------------------------------------------------------------------------ solvers


def _ramanujan_half(a: float, b: float) -> float:
    return 0.5 * np.pi * (3 * (a + b) - np.sqrt((3 * a + b) * (a + 3 * b)))


@pytest.mark.parametrize("width", [0.05, 0.07, 0.1])
@pytest.mark.parametrize("depth", [0.005, 0.018, 0.04])
def test_half_ellipse_width_inverts_the_half_ellipse_length(width, depth):
    got = _half_ellipse_width(_ramanujan_half(width, depth), depth)
    assert got == pytest.approx(width, abs=1e-9), f"width {got}, expected {width}"


@pytest.mark.parametrize("length", [0.12, 0.16, 0.2])
def test_half_ellipse_width_back_neck_cut_to_the_collar_length(length):
    # As `draft_shirt` cuts it: the back neckline as long as the collar's back.
    depth = 0.018
    width = _half_ellipse_width(length, depth)
    back = ShirtPattern(_torso(neck_u=width, neck_drop=depth), 0.06, 0, 0, 0, 0, DART_V)
    neck = _by_name(back_outline(back))["neck"]
    assert neck.length == pytest.approx(length, abs=1e-3), f"neck {neck.length} m"


@pytest.mark.parametrize("length", [0.095, 0.105, 0.115, 0.12])
def test_vee_u_front_neckline_reaches_the_length(length):
    u = _vee_u(FRONT_TORSO, VEE_V, length)
    assert 0.0 < u <= FRONT_TORSO.neck_u, f"u = {u} off the front"
    got = _curve_length(_neck_curve(FRONT_TORSO, (u, VEE_V)))
    assert got == pytest.approx(length, abs=1e-4), f"neckline {got} m at u = {u}"


@pytest.mark.parametrize(
    ("length", "expected"), [(0.3, 0.005), (0.01, FRONT_TORSO.neck_u)], ids=["long", "short"]
)
def test_vee_u_unreachable_length_stops_at_the_bounds(length, expected):
    # Too long: as far in as the centre allows; too short: straight down from the side
    # neck point.
    u = _vee_u(FRONT_TORSO, VEE_V, length)
    assert u == pytest.approx(expected, abs=1e-6), f"u = {u}"


# ------------------------------------------------------------------------------ button


def _bent_place(flat: F64) -> F64:
    """A curved placement: the points' shift is not uniform."""
    return np.c_[flat[:, 0], 1.0 + flat[:, 1], 0.1 + 0.5 * flat[:, 0] ** 2]


BUTTON_POINT = np.array([0.0, 0.5])
BUTTON_TARGET = np.array([0.004, 1.47, 0.16])


def test_button_held_pattern_point_lands_on_the_target():
    held = button_held(_bent_place, BUTTON_POINT, BUTTON_TARGET)
    got = held(BUTTON_POINT[None])[0]
    assert np.allclose(got, BUTTON_TARGET, atol=1e-12), f"held at {got}"


@pytest.mark.parametrize("reach", [0.5, 1.0, 2.0, 5.0])
def test_button_held_pull_falls_off_over_button_reach(reach):
    held = button_held(_bent_place, BUTTON_POINT, BUTTON_TARGET)
    shift = BUTTON_TARGET - _bent_place(BUTTON_POINT[None])[0]
    angles = np.linspace(0, 2 * np.pi, 8, endpoint=False)
    ring = BUTTON_POINT + reach * BUTTON_REACH * np.stack([np.cos(angles), np.sin(angles)], 1)
    moved = held(ring) - _bent_place(ring)
    expected = np.exp(-0.5 * reach**2) * shift
    assert np.allclose(moved, expected, atol=1e-12), f"moved {moved[0]}, expected {expected}"


def test_button_held_far_points_essentially_unmoved():
    held = button_held(_bent_place, BUTTON_POINT, BUTTON_TARGET)
    far = BUTTON_POINT + np.array([[6 * BUTTON_REACH, 0.0], [0.0, -8 * BUTTON_REACH]])
    moved = np.linalg.norm(held(far) - _bent_place(far), axis=1)
    assert moved.max() < 1e-6, f"far points moved {moved} m"


# ------------------------------------------------------------------------------ profiles


def _sagittal_body(bulge: float) -> F64:
    """A slab 2 cm wide at x = 0 from y = 0 to 1: the front at z = 0.1 bulging `bulge`
    forward in the middle (a chest), a flat back at z = -0.1, under a pitched roof peaking
    5 cm higher at z = 0."""
    y = np.linspace(0.0, 1.0, 201)
    front = 0.1 + bulge * np.sin(np.pi * y)
    z = np.linspace(-0.1, 0.1, 41)
    roof = 1.05 - 0.5 * np.abs(z)
    parts = []
    for x in (-0.004, 0.0, 0.004):
        parts.append(np.stack([np.full_like(y, x), y, front], 1))
        parts.append(np.stack([np.full_like(y, x), y, np.full_like(y, -0.1)], 1))
        parts.append(np.stack([np.full_like(z, x), roof, z], 1))
    return np.concatenate(parts)


@pytest.mark.parametrize("front", [True, False])
def test_surface_profile_starts_at_bottom_and_never_decreases(front):
    length, height = surface_profile(_sagittal_body(0.04), 0.0, 0.0, front)
    assert len(length) == len(height), "profile arrays differ in length"
    assert length[0] == 0.0 and height[0] == 0.0, f"starts at ({length[0]}, {height[0]})"
    assert (np.diff(length) >= 0).all(), "surface length decreases"
    assert (np.diff(height) >= -1e-12).all(), "height decreases"
    assert height[-1] == pytest.approx(1.05), f"stops at {height[-1]}, not the roof's peak"


@pytest.mark.parametrize("front", [True, False])
def test_surface_profile_surface_length_at_least_height_climbed(front):
    length, height = surface_profile(_sagittal_body(0.04), 0.0, 0.0, front)
    climbed = height - height[0]
    assert (length >= climbed - 1e-12).all(), "a row climbs more than its surface length"


@pytest.mark.parametrize("front", [True, False])
def test_surface_profile_total_matches_surface_length(front):
    # The pattern's v is drafted with `surface_length`; placing by the profile has to
    # reach the same total or the top rows land off the shoulders.
    points = _sagittal_body(0.04)
    length, _ = surface_profile(points, 0.0, 0.0, front)
    expected = surface_length(points, 0.0, 0.0, front)
    assert length[-1] == pytest.approx(expected, abs=1e-12), f"{length[-1]} vs {expected}"


def test_surface_profile_front_over_a_chest_longer_than_the_flat_back():
    points = _sagittal_body(0.04)
    front, _ = surface_profile(points, 0.0, 0.0, True)
    back, _ = surface_profile(points, 0.0, 0.0, False)
    # The flat back: 1 m up and one roof slope. The front bulges, so it is longer.
    assert back[-1] == pytest.approx(1.0 + np.hypot(0.1, 0.05), abs=1e-6), f"back {back[-1]}"
    assert front[-1] > back[-1] + 1e-3, f"front {front[-1]} is not longer than {back[-1]}"


def test_surface_profile_slab_above_bottom_rises_straight_up():
    length, height = surface_profile(_sagittal_body(0.0), 0.0, -0.2, True)
    assert height[:2] == pytest.approx([-0.2, 0.0]), f"heights {height[:2]}"
    assert length[:2] == pytest.approx([0.0, 0.2]), f"lengths {length[:2]}"


def test_surface_profile_without_body_raises_garment_error():
    with pytest.raises(GarmentError):
        surface_profile(_sagittal_body(0.04), 0.5, 0.0, True)


def test_placed_by_height_rows_follow_the_profile_then_straight_up():
    hem = 0.9
    length = np.array([0.0, 0.1, 0.32, 0.55])
    height = np.array([hem, hem + 0.1, hem + 0.3, hem + 0.48])
    place = placed_by_height(_place_up(hem), length, height, hem)
    v = np.array([0.0, 0.05, 0.2, 0.4, 0.55, 0.6, 0.7])
    u = np.linspace(-0.2, 0.2, len(v))
    got = place(np.stack([u, v], 1))
    expected = np.interp(v, length, height) + np.clip(v - length[-1], 0.0, None)
    assert np.allclose(got[:, 0], u), "u changed"
    assert np.allclose(got[:, 1], expected), f"heights {got[:, 1]}, expected {expected}"
    above = v > length[-1]
    assert np.allclose(got[above, 1] - height[-1], v[above] - length[-1]), "not straight up"


# ------------------------------------------------------------------------------ rings

CHEST = 1.3
CAP = 1.35
GAP = 0.012
RING_HEIGHTS = np.arange(0.95, 1.45, 0.01)


@cache
def _trunk() -> F64:
    """Stacked ellipses every 5 mm from 0.9 to 1.5 m, fullest (a chest) at 1.3 m."""
    angle = np.linspace(0, 2 * np.pi, 64, endpoint=False)
    layers = []
    for h in np.arange(0.9, 1.5001, 0.005):
        bump = np.exp(-(((h - CHEST) / 0.06) ** 2))
        a, b = 0.15 + 0.02 * bump, 0.10 + 0.04 * bump
        layers.append(np.stack([a * np.cos(angle), np.full_like(angle, h), b * np.sin(angle)], 1))
    return np.concatenate(layers)


def _half_width(value: float) -> PchipInterpolator:
    return PchipInterpolator([0.9, 1.1, CAP], [value, value, value])


def test_hanging_rings_below_the_chest_enclose_the_torso_up_to_it():
    trunk = _trunk()
    rings = hanging_rings(trunk, RING_HEIGHTS, _half_width(0.1), CAP, GAP, CHEST)
    below = [r for r in rings if r.height < CHEST - 0.005]
    assert below, "no rings below the chest"
    for ring in below:
        band = trunk[(trunk[:, 1] >= ring.height) & (trunk[:, 1] <= CHEST)][:, [0, 2]]
        hull = convex_hull(band)
        perimeter = float(np.linalg.norm(np.roll(hull, -1, 0) - hull, axis=1).sum())
        assert ring.perimeter >= perimeter + 0.99 * 2 * np.pi * GAP, (
            f"ring at {ring.height:.2f}: {ring.perimeter:.4f} m round a {perimeter:.4f} m hull"
        )
        assert _inside(ring.points[:-1], band).all(), f"ring at {ring.height:.2f} cuts the body"


def test_hanging_rings_waist_ring_wider_than_the_jersey_ring():
    trunk = _trunk()
    heights = np.array([1.0, 1.1])
    woven = hanging_rings(trunk, heights, _half_width(0.1), CAP, GAP, CHEST)
    jersey = torso_rings(trunk, heights, _half_width(0.1), CAP, GAP)
    for w, j in zip(woven, jersey, strict=True):
        assert w.perimeter > j.perimeter + 0.05, (
            f"at {w.height}: woven {w.perimeter:.3f} m, jersey {j.perimeter:.3f} m"
        )


def test_hanging_rings_above_the_cap_flagged_above():
    rings = hanging_rings(_trunk(), RING_HEIGHTS, _half_width(0.1), CAP, GAP, CHEST)
    for ring in rings:
        assert ring.above == (ring.height > CAP), f"ring at {ring.height:.2f}: {ring.above}"


def test_hanging_rings_wide_pattern_sets_the_ring_to_four_half_widths():
    # A pattern wider than the hull plus the gap: a quarter of each ring is the half-width,
    # so the side seams start together.
    half = 0.3
    rings = hanging_rings(_trunk(), RING_HEIGHTS, _half_width(half), CAP, GAP, CHEST)
    for ring in (r for r in rings if r.height <= CAP):
        assert ring.perimeter == pytest.approx(4 * half, rel=2e-3), (
            f"ring at {ring.height:.2f}: {ring.perimeter:.4f} m"
        )


# ------------------------------------------------------------------------------ sleeves

SHOULDER = np.array([0.20, 1.40, 0.0])
ELBOW = np.array([0.30, 1.13, 0.02])
WRIST = np.array([0.36, 0.92, 0.16])  # the forearm runs forward
SLEEVE_LENGTH = 0.5
SLEEVE_CAP = 0.12
SLEEVE_TOP = SLEEVE_LENGTH + SLEEVE_CAP
SLEEVE_OFFSET = -0.02
SLEEVE_GAP = 0.015
LIFT = np.radians(5.0)


@cache
def _arm() -> ArmLine:
    upper = resample(np.stack([SHOULDER, ELBOW]), 81)
    lower = resample(np.stack([ELBOW, WRIST]), 81)
    points = np.concatenate([upper, lower[1:]])
    arc = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(points, axis=0), axis=1))])
    return ArmLine(points, arc, float(np.linalg.norm(ELBOW - SHOULDER)), 0.17)


def _sleeve_width(v: F64) -> F64:
    return 0.24 + (0.32 - 0.24) * np.clip(v / SLEEVE_LENGTH, 0.0, 1.0)


def _sleeve(mirror: bool, lift: float = LIFT, gap: float = SLEEVE_GAP) -> Place:
    return bent_sleeve_place(_arm(), SLEEVE_TOP, SLEEVE_OFFSET, lift, _sleeve_width, gap, mirror)


def _row(v: float, count: int = 25) -> F64:
    """A row across the sleeve, underarm seam to underarm seam."""
    half = 0.5 * float(_sleeve_width(np.array([v]))[0])
    u = np.linspace(-half, half, count)
    return np.stack([u, np.full_like(u, v)], 1)


def _radius(v: float, gap: float = SLEEVE_GAP) -> float:
    return float(_sleeve_width(np.array([v]))[0]) / (2 * np.pi) + gap


def _arc_of(v: float) -> float:
    return SLEEVE_OFFSET + SLEEVE_TOP - v


def _on_arm(arc: float) -> F64:
    line = _arm()
    return np.array([np.interp(arc, line.arc, line.points[:, d]) for d in range(3)])


@pytest.mark.parametrize("v", [0.12, 0.2, 0.28])
def test_bent_sleeve_forearm_rows_at_the_sleeve_radius_from_the_arm(v):
    assert _arc_of(v) > _arm().elbow + 0.02, "not a forearm row"
    dense = cKDTree(resample(_arm().points, 20000))
    distance = dense.query(_sleeve(False)(_row(v)))[0]
    expected = _radius(v)
    assert np.allclose(distance, expected, atol=1e-5), (
        f"v = {v}: {distance.min():.5f}..{distance.max():.5f} m, expected {expected:.5f}"
    )


def test_bent_sleeve_cuff_past_the_wrist_continues_along_the_forearm():
    # The cuff's edge reaches past the wrist joint: there the sleeve runs on straight.
    line = _arm()
    v = 0.0
    past = _arc_of(v) - line.arc[-1]
    assert past > 0.0, "the hem row does not reach past the wrist"
    tangent = (WRIST - ELBOW) / np.linalg.norm(WRIST - ELBOW)
    centre = WRIST + past * tangent
    radial = _sleeve(False)(_row(v)) - centre
    assert np.allclose(np.linalg.norm(radial, axis=1), _radius(v), atol=1e-9), "off radius"
    assert np.allclose(radial @ tangent, 0.0, atol=1e-9), "the cuff ring is not square on"


@pytest.mark.parametrize("v", [0.0, 0.2, 0.45, 0.55, SLEEVE_TOP])
def test_bent_sleeve_right_is_the_x_mirror_of_the_left_with_u_flipped(v):
    # Mirroring turns the faces inside out; flipping u turns them back.
    flat = _row(v)
    left = _sleeve(False)(flat)
    right = _sleeve(True)(flat * np.array([-1.0, 1.0]))
    assert np.allclose(right, left * MIRROR_X, atol=1e-12), (
        f"v = {v}: {np.abs(right - left * MIRROR_X).max()} m off the mirror"
    )


@pytest.mark.parametrize("v", [0.2, 0.3, 0.4, 0.45, 0.5, 0.55, 0.6])
def test_bent_sleeve_lift_raises_the_upper_arm_only(v):
    flat = _row(v)
    shift = _sleeve(False)(flat) - _sleeve(False, lift=0.0)(flat)
    arc = _arc_of(v)
    elbow = _arm().elbow
    expected = np.sin(LIFT) * arc * np.clip(1.0 - arc / elbow, 0.0, 1.0) * 2.0
    size = np.linalg.norm(shift, axis=1)
    assert np.allclose(shift, shift[0], atol=1e-12), f"v = {v}: the row is not moved as one"
    assert size[0] == pytest.approx(expected, abs=1e-5), f"v = {v}: raised {size[0]} m"
    if expected > 1e-3:
        assert shift[0, 0] > 0, f"v = {v}: the left upper arm is not raised away from the torso"


@pytest.mark.parametrize("mirror", [False, True])
@pytest.mark.parametrize("v", [0.2, 0.45])
def test_bent_sleeve_underarm_seam_faces_the_torso(mirror, v):
    # u = 0 (the cap's middle) runs down the arm's outside, the underarm seam (u = +-half)
    # down its inside: for the left arm (+x) toward -x, for the right toward +x.
    points = _sleeve(mirror)(_row(v))
    side = -1.0 if mirror else 1.0
    out = side * points[:, 0]
    middle, seams = out[len(out) // 2], out[[0, -1]]
    assert (seams < middle).all(), f"v = {v}: seam {seams}, middle {middle}"
    centre = side * (_on_arm(_arc_of(v)) * (MIRROR_X if mirror else 1.0))[0]
    assert middle > centre > seams.max(), f"v = {v}: the arm is not between them"


# ------------------------------------------------------------------------------ collar

NECK_RADIUS = 0.06
NECK_Z = 0.01  # the neck's axis sits off z = 0: the collar must find it
HPS = 1.45


@cache
def _cylinder() -> tuple[F64, np.ndarray]:
    """An open cylinder (no caps) round x = 0, z = NECK_Z, rows every 5 mm."""
    count = 96
    angle = np.linspace(0, 2 * np.pi, count, endpoint=False)
    heights = np.arange(HPS - 0.3, HPS + 0.1001, 0.005)
    positions = np.concatenate(
        [
            np.stack(
                [
                    NECK_RADIUS * np.sin(angle),
                    np.full(count, h),
                    NECK_Z + NECK_RADIUS * np.cos(angle),
                ],
                1,
            )
            for h in heights
        ]
    )
    triangles = []
    for row in range(len(heights) - 1):
        for i in range(count):
            a, b = row * count + i, row * count + (i + 1) % count
            c, d = a + count, b + count
            triangles += [(a, b, c), (b, d, c)]
    return positions, np.array(triangles, dtype=np.int64)


def _radial(points: F64) -> F64:
    return np.hypot(points[:, 0], points[:, 2] - NECK_Z)


@cache
def _collar() -> Collar:
    positions, triangles = _cylinder()
    return collar_rings(
        (positions, triangles), Neck(positions, triangles, HPS - 0.05), HPS, ShirtSpec()
    )


def test_surface_hits_cylinder_on_its_radius_with_outward_normals():
    positions, triangles = _cylinder()
    theta = np.radians([0.0, 37.0, 90.0, 180.0, 271.0])
    heights = np.full(len(theta), HPS - 0.0123)
    hits, normals = _surface_hits(positions, triangles, NECK_Z, heights, theta)
    assert np.allclose(hits[:, 1], heights), "hits left the ray's height"
    # A 96-sided cylinder: the faces sit up to R (1 - cos(pi / 96)) inside the circle.
    assert np.allclose(_radial(hits), NECK_RADIUS, atol=NECK_RADIUS * 6e-4), _radial(hits)
    direction = np.stack([np.sin(theta), np.zeros(len(theta)), np.cos(theta)], 1)
    assert np.allclose(np.linalg.norm(normals, axis=1), 1.0), "normals are not unit"
    assert (np.einsum("ij,ij->i", normals, direction) > 0.99).all(), "normals not outward"


def test_surface_hits_missing_skin_raises_garment_error():
    positions, triangles = _cylinder()
    with pytest.raises(GarmentError):
        _surface_hits(positions, triangles, NECK_Z, np.array([HPS + 1.0]), np.array([0.0]))


def test_collar_rings_base_and_top_sit_a_gap_off_the_neck():
    collar, spec = _collar(), ShirtSpec()
    for name in ("base", "top"):
        ring = getattr(collar, name)
        assert np.allclose(_radial(ring), NECK_RADIUS + spec.collar_gap, atol=3e-4), (
            f"{name}: {_radial(ring).min():.4f}..{_radial(ring).max():.4f} m from the axis"
        )
    clearance = _radial(collar.outer) - NECK_RADIUS
    assert clearance.min() >= spec.fall_gap - 5e-4, f"the fall's edge is {clearance.min()} m off"


def test_collar_rings_run_from_the_left_front_round_the_back_dropping_in_front():
    collar, spec = _collar(), ShirtSpec()
    base = collar.base
    back = len(base) // 2
    assert base[0, 0] > 0 > base[-1, 0], "the ring does not start at the wearer's left"
    assert base[back, 2] < NECK_Z < base[0, 2], "the middle is not at the back"
    assert np.allclose(collar.front_end, base[0]), "front_end is not the base's start"
    expected = HPS - spec.collar_front_drop * np.cos(np.radians(spec.collar_open))
    assert base[0, 1] == pytest.approx(expected, abs=1e-9), f"front end at {base[0, 1]}"
    assert base[back, 1] == pytest.approx(HPS - spec.collar_back_drop, abs=1e-3), "back drop"
    assert base[0, 1] < base[back, 1], "the neckline is not lower in front"
    # The stand at the back is its full height.
    stand = collar.top[back, 1] - base[back, 1]
    assert stand == pytest.approx(spec.stand, abs=1e-9), f"stand {stand} m at the back"


def test_collar_rings_side_neck_points_symmetric_about_the_back():
    collar = _collar()
    left, right = collar.sides
    assert collar.share[0] == 0.0 and collar.share[-1] == pytest.approx(1.0), "share range"
    assert (np.diff(collar.share) > 0).all(), "share does not increase round the ring"
    assert 0.0 < left < 0.5 < right < 1.0, f"sides {collar.sides}"
    assert left + right == pytest.approx(1.0, abs=1e-6), f"sides {collar.sides}"


def test_stand_place_maps_its_edges_onto_the_base_and_top_rings():
    collar = _collar()
    length, height = 0.4, ShirtSpec().stand
    place = stand_place(collar, length, height)
    flat = np.array([[0.0, 0.0], [length, 0.0], [0.0, height], [length, height]])
    got = place(flat)
    expected = np.array([collar.base[0], collar.base[-1], collar.top[0], collar.top[-1]])
    assert np.allclose(got, expected), f"corners at {got}"
    # Halfway round is the centre back, and the stand runs straight from base to top.
    low, middle, high = place(np.array([[0.5 * length, t * height] for t in (0.0, 0.5, 1.0)]))
    assert np.allclose(middle, 0.5 * (low + high)), f"middle {middle}"
    assert abs(low[0]) < 2e-4 and low[2] < NECK_Z, f"halfway round at {low}, not the back"


def test_fall_place_runs_from_the_outer_edge_over_the_middle_to_the_fold():
    collar = _collar()
    length, height = 0.4, 0.09
    share = np.full(len(collar.base), 0.3)
    place = fall_place(collar, length, height, share)
    flat = np.array([[0.0, 0.0], [0.0, height], [0.0, height * (1 - 0.3)], [length, 0.0]])
    got = place(flat)
    expected = np.array([collar.outer[0], collar.fold[0], collar.middle[0], collar.outer[-1]])
    assert np.allclose(got, expected), f"edge, fold, middle, far edge at {got}"
