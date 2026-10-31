"""Long-sleeve woven shirt drafted to the outfit-base body as a flat pattern.

Pieces: one front (the neck open in a V, the top button undone; the placket below it and
the buttons are drawn in the maps), a back, two long sleeves whose hems are the cuffs, and
a collar: a stand sewn to the neckline and a fall folded down over it. The collar is cut
to the neck rather than draped: both pieces start shaped round the neck (`collar_rings`)
and stay pinned there, the neckline is sewn to the stand and the shirt hangs from it.
Women's fronts take a bust dart at each side seam: woven cloth does not stretch over the
bust the way the tee's jersey does.

The sleeves start wrapped round the bent arm of the A-pose (shoulder, elbow, wrist): a
straight sleeve along the upper arm would miss the forearm, which runs forward.
"""

from collections.abc import Callable
from dataclasses import dataclass, replace

import numpy as np
from scipy.interpolate import PchipInterpolator

from asset_pipeline.garments import GarmentError
from asset_pipeline.garments.body import BaseBody, convex_hull, offset_hull
from asset_pipeline.garments.collider import Neck, closed_body
from asset_pipeline.garments.flat import (
    F64,
    I64,
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
from asset_pipeline.garments.tee import (
    BACK,
    FRONT,
    NECK_REACH,
    SECTION,
    SLEEVE_L,
    SLEEVE_R,
    Measures,
    Ring,
    TeeSpec,
    TorsoPattern,
    _cap_height,
    _slab,
    _sleeve,
    arm_share,
    arm_slice,
    make_ring,
    measure,
    surface_length,
    torso_place,
)

STAND = "stand"
FALL = "fall"
COLLAR_SAMPLES = 121  # points round the collar rings
COLLAR_SLAB = 0.005  # half-height of the neck slab the surface is read from (m)
COLLAR_FLARE = 0.005  # metres the neckline sits out from the neck's column
ELBOW_ROUND = 0.06  # metres of the arm's bend at the elbow rounded off
WRIST_SHARE = 0.85  # of the forearm, where the wrist girth is taken
BUTTON_RADIUS = 0.0055  # metres
AXILLA_FRONT = 0.05  # metres in front of the armpit's middle: its front fold
BUTTON_LIFT = 0.008  # metres the held V point stands off the skin
BUTTON_HOLD = 0.02  # metres of cloth round the V's point held (pattern distance)
BUTTON_REACH = 0.05  # metres over which the start is drawn to the held point
BUTTON_PITCH = 0.09  # metres between the front buttons


@dataclass(frozen=True)
class ShirtSpec(TeeSpec):
    name: str = "AS_Shirt"
    hem_above_hip: float = -0.08  # the shirttail's middle, under the widest hip
    side_rise: float = 0.06  # the hem's rise at the side seams
    chest_ease: float = 0.14
    waist_ease: float = 0.18
    hem_ease: float = 0.14
    bicep_ease: float = 0.10
    cap_ease: float = 0.008
    sleeve_gap: float = 0.015
    sleeve_lift: float = 5.0
    cuff: float = 0.06  # cuff height: a stiff band at the sleeve's hem
    cuff_ease: float = 0.06  # round the wrist
    wrist_extra: float = 0.045  # the cuff's edge past the wrist joint (in the A-pose)
    arm_band: float = 0.04  # torso cloth by the armhole that partly follows the arm: the
    # roomy armhole's cloth taken along by a lowered arm left the chest's side bare
    dart: float = 0.0  # a bust dart's intake at each side seam (0: no dart)
    dart_below: float = 0.08  # the dart's side-seam point under the armhole bottom
    dart_length: float = 0.10
    collar_front_drop: float = 0.09  # neckline under the side neck point at the centre front
    collar_back_drop: float = 0.018  # and at the centre back
    collar_open: float = 58.0  # degrees from the centre front where the stand ends
    vee: float = 0.08  # the open neck's V under the stand's front ends (on the pattern)
    vee_drop: float = 0.065  # and on the body: the first closed button under them
    stand: float = 0.032  # stand height at the back
    stand_front: float = 0.022  # and at its front ends
    fall_back: float = 0.015  # fall past the stand at the back
    fall_point: float = 0.06  # and at the collar points
    collar_spread: float = 0.7  # how far sideways the collar points turn (open collar)
    collar_gap: float = 0.005  # stand off the neck
    fall_gap: float = 0.012  # fall's outer edge off the skin (over the shirt)
    placket: float = 0.035
    hem_band: float = 0.01
    left_over_right: bool = True  # men's fronts: the left front laps over the right
    pocket: bool = False  # a patch pocket on the left chest
    spacing: float = 0.012


SHIRT_MALE = ShirtSpec(
    hem_above_hip=-0.10,
    underarm_drop=0.05,
    chest_ease=0.16,
    waist_ease=0.18,
    hem_ease=0.16,
    straight=True,
    bust=False,
    shoulder_out=0.03,
    bicep_ease=0.10,
    pocket=True,
)
SHIRT_FEMALE = ShirtSpec(
    hem_above_hip=-0.06,
    underarm_drop=0.04,
    chest_ease=0.10,
    waist_ease=0.14,
    hem_ease=0.12,
    shoulder_out=0.02,
    bicep_ease=0.08,
    dart=0.025,
    collar_front_drop=0.085,
    vee_drop=0.06,
    stand=0.03,
    stand_front=0.02,
    fall_point=0.055,
    left_over_right=False,
)


# ------------------------------------------------------------------------------ collar


@dataclass(frozen=True, eq=False)
class Collar:
    """Collar rings, each (K, 3), from the left front end (wearer's left, +x) round the
    back to the right front end."""

    base: F64  # the stand's neckline edge
    top: F64  # the stand's top edge
    fold: F64  # the fall's fold, just outside the stand's top
    middle: F64  # the fall over the stand's base
    outer: F64  # the fall's outer edge
    share: F64  # (K,) arc length share of each base point
    sides: tuple[float, float]  # shares of the side neck points (left, right)
    front_end: F64  # (3,) the left front end of the base (the right one mirrors it)


def _surface_hits(
    positions: F64, triangles: I64, centre: float, heights: F64, theta: F64
) -> tuple[F64, F64]:
    """Where horizontal rays from the neck axis (x = 0, z = `centre`) at each height and
    direction (0 the centre front, pi/2 the wearer's left) leave the skin, and the skin's
    outward normal there."""
    corners = positions[triangles]
    low, high = corners[:, :, 1].min(1), corners[:, :, 1].max(1)
    hits = np.empty((len(theta), 3))
    normals = np.empty((len(theta), 3))
    for i, (h, t) in enumerate(zip(heights, theta, strict=True)):
        near = (low <= h) & (high >= h)
        a, b, c = corners[near, 0], corners[near, 1], corners[near, 2]
        origin = np.array([0.0, h, centre])
        direction = np.array([np.sin(t), 0.0, np.cos(t)])
        e1, e2 = b - a, c - a
        p = np.cross(direction, e2)
        det = np.einsum("ij,ij->i", e1, p)
        ok = np.abs(det) > 1e-12
        inverse = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0.0)
        rel = origin - a
        u = np.einsum("ij,ij->i", rel, p) * inverse
        q = np.cross(rel, e1)
        v = (q @ direction) * inverse
        distance = np.einsum("ij,ij->i", e2, q) * inverse
        hit = ok & (u >= -1e-9) & (v >= -1e-9) & (u + v <= 1 + 1e-9) & (distance > 1e-6)
        if not hit.any():
            raise GarmentError(f"no skin toward {np.degrees(t):.0f} deg at {h:.3f} m")
        k = np.flatnonzero(hit)[distance[hit].argmin()]
        normal = np.cross(e1[k], e2[k])
        normal /= np.linalg.norm(normal)
        hits[i] = origin + distance[k] * direction
        normals[i] = normal if normal @ direction > 0 else -normal
    return hits, normals


def _smooth(values: F64, passes: int = 3) -> F64:
    out = values.copy()
    for _ in range(passes):
        out[1:-1] = 0.25 * out[:-2] + 0.5 * out[1:-1] + 0.25 * out[2:]
    return out


def collar_rings(collider: tuple[F64, I64], neck: Neck, hps: float, spec: ShirtSpec) -> Collar:
    """The collar shaped round the neck: the stand's base on the skin at the neckline
    (lower in front), its top on the neck a stand's height up (so the stand leans in), the
    fall folded down over the stand and out onto the shoulders, to the collar points."""
    positions, triangles = collider
    above = neck.positions[np.abs(neck.positions[:, 1] - (hps + 0.015)) < COLLAR_SLAB]
    if len(above) < 8:
        raise GarmentError("no neck above the side neck point")
    centre = 0.5 * float(above[:, 2].min() + above[:, 2].max())
    start = np.radians(spec.collar_open)
    theta = np.linspace(start, 2 * np.pi - start, COLLAR_SAMPLES)
    cos = np.cos(theta)
    drop = spec.collar_front_drop * np.clip(cos, 0, None)
    drop += spec.collar_back_drop * np.clip(-cos, 0, None) ** 2
    front = np.clip((cos - np.cos(np.radians(110))) / (1 - np.cos(np.radians(110))), 0, 1)
    stand = spec.stand + (spec.stand_front - spec.stand) * front
    extra = spec.fall_back + (spec.fall_point - spec.fall_back) * front**2
    out3 = np.stack([np.sin(theta), np.zeros(len(theta)), np.cos(theta)], 1)

    def on_skin(heights: F64, gap: float) -> F64:
        """`gap` off the skin along its normal, smoothed round the ring."""
        hits, normals = _surface_hits(positions, triangles, centre, heights, theta)
        points = hits + gap * normals
        for d in range(3):
            points[:, d] = _smooth(points[:, d])
        return points

    # The neckline sits where the neck meets the shoulders, not out on their slope: from
    # its nominal height each point climbs until the skin is within COLLAR_FLARE of the
    # neck's own column (read well above the shoulders).
    def radial_of(points: F64) -> F64:
        return np.linalg.norm(points[:, [0, 2]] - np.array([0.0, centre]), axis=1)

    column = radial_of(
        _surface_hits(positions, triangles, centre, np.full(len(theta), hps + 0.04), theta)[0]
    )
    base_y = hps - drop
    for _ in range(40):
        wide = radial_of(_surface_hits(positions, triangles, centre, base_y, theta)[0])
        wide = wide > column + COLLAR_FLARE
        if not wide.any():
            break
        base_y = np.where(wide, base_y + 0.003, base_y)
    base_y = _smooth(base_y)
    base = on_skin(base_y, spec.collar_gap)
    # The stand's top on the neck a stand's height up: it leans in with the neck.
    top = on_skin(base_y + stand, spec.collar_gap)
    fold = top + out3 * (spec.collar_gap + 0.0005) + np.array([0.0, 0.002, 0.0])
    middle = base + out3 * 0.004
    # Down the stand's slope and on, out over the shoulders, then off the skin.
    slope = base - top
    slope /= np.linalg.norm(slope, axis=1, keepdims=True)
    # The collar points turn out sideways, lying open on the chest.
    lateral = np.stack([np.sign(np.sin(theta)), np.zeros(len(theta)), np.zeros(len(theta))], 1)
    slope = slope + (spec.collar_spread * front**2)[:, None] * lateral
    slope /= np.linalg.norm(slope, axis=1, keepdims=True)
    outer = middle + slope * extra[:, None]
    # Off the skin by at least `fall_gap` along its normal: room for the shirt under it.
    hits, normals = _surface_hits(positions, triangles, centre, outer[:, 1], theta)
    clearance = np.einsum("ij,ij->i", outer - hits, normals)
    outer = outer + np.clip(spec.fall_gap - clearance, 0.0, None)[:, None] * normals
    for d in range(3):
        outer[:, d] = _smooth(outer[:, d])
    steps = np.linalg.norm(np.diff(base, axis=0), axis=1)
    arc = np.concatenate([[0.0], np.cumsum(steps)])
    share = arc / arc[-1]
    left = float(np.interp(np.pi / 2, theta, share))
    right = float(np.interp(3 * np.pi / 2, theta, share))
    return Collar(base, top, fold, middle, outer, share, (left, right), base[0].copy())


def _ring_at(ring: F64, share: F64, s: F64) -> F64:
    return np.stack([np.interp(s, share, ring[:, d]) for d in range(3)], 1)


def stand_place(collar: Collar, length: float, height: float) -> Place:
    def place(flat: F64) -> F64:
        s = np.clip(flat[:, 0] / length, 0.0, 1.0)
        t = np.clip(flat[:, 1] / height, 0.0, 1.0)[:, None]
        return (1 - t) * _ring_at(collar.base, collar.share, s) + t * _ring_at(
            collar.top, collar.share, s
        )

    return place


def fall_place(collar: Collar, length: float, height: float, stand_share: F64) -> Place:
    """v = 0 is the outer edge, v = height the fold; the stand's height takes
    `stand_share` of the way from the fold at each point round."""

    def place(flat: F64) -> F64:
        s = np.clip(flat[:, 0] / length, 0.0, 1.0)
        t = np.clip(1.0 - flat[:, 1] / height, 0.0, 1.0)  # 0 at the fold
        k = np.interp(s, collar.share, stand_share)
        fold = _ring_at(collar.fold, collar.share, s)
        middle = _ring_at(collar.middle, collar.share, s)
        outer = _ring_at(collar.outer, collar.share, s)
        upper = (t / k)[:, None]
        lower = ((t - k) / (1 - k))[:, None]
        return np.where(
            (t <= k)[:, None], fold + upper * (middle - fold), middle + lower * (outer - middle)
        )

    return place


# ------------------------------------------------------------------------------ sleeves


@dataclass(frozen=True, eq=False)
class ArmLine:
    points: F64  # (N, 3) from the shoulder down the arm's middle to the wrist
    arc: F64  # (N,) arc length
    elbow: float  # arc length of the elbow
    wrist_girth: float


def arm_line(body: BaseBody, m: Measures) -> ArmLine:
    """The left arm's middle: the upper arm's line (`measure`) to the elbow, the forearm's
    own line to the wrist, the bend rounded off."""
    if body.limb is None or "hand_l" not in body.joints:
        raise GarmentError("the base body has no hand joint")
    arm = body.positions[body.limb & (body.positions[:, 0] > 0)]
    elbow_joint, hand = body.joints["lowerarm_l"], body.joints["hand_l"]
    near, _ = arm_slice(arm, elbow_joint, hand, 0.3)
    far, _ = arm_slice(arm, elbow_joint, hand, 0.7)
    _, wrist_girth = arm_slice(arm, elbow_joint, hand, WRIST_SHARE)
    length = float(np.linalg.norm(hand - elbow_joint))
    direction = (far - near) / np.linalg.norm(far - near)
    forearm_start = near - 0.3 * length * direction
    wrist = near + 0.7 * length * direction
    elbow = 0.5 * (m.elbow + forearm_start)
    upper = (elbow - m.shoulder) / np.linalg.norm(elbow - m.shoulder)
    lower = (wrist - elbow) / np.linalg.norm(wrist - elbow)
    bend = bezier(elbow - ELBOW_ROUND * upper, elbow, elbow, elbow + ELBOW_ROUND * lower, 16)
    points = np.concatenate([m.shoulder[None], bend, wrist[None]])
    points = resample(points, 160)
    arc = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(points, axis=0), axis=1))])
    at_elbow = float(arc[np.linalg.norm(points - elbow, axis=1).argmin()])
    return ArmLine(points, arc, at_elbow, wrist_girth)


def bent_sleeve_place(
    line: ArmLine,
    top_v: float,
    offset: float,
    lift: float,
    width: Callable[[F64], F64],
    gap: float,
    mirror: bool,
) -> Place:
    """Wrap a sleeve round the bent arm: u around (the underarm seam toward the torso), v
    up the arm to the cap, its rows' rings as wide as the sleeve there. Frames follow the
    arm without twisting; the upper arm starts raised, clear of the torso (about `lift`
    radians near the shoulder, back on the arm by the elbow)."""
    points = line.points * (np.array([-1.0, 1.0, 1.0]) if mirror else 1.0)
    tangent = np.gradient(points, axis=0)
    tangent /= np.linalg.norm(tangent, axis=1, keepdims=True)
    up = np.array([0.0, 1.0, 0.0])
    outs = np.empty_like(points)
    out = up - (up @ tangent[0]) * tangent[0]
    for i, axis in enumerate(tangent):
        out = out - (out @ axis) * axis
        out /= np.linalg.norm(out)
        outs[i] = out
    left = not mirror
    fronts = np.cross(outs, tangent) if left else np.cross(tangent, outs)
    flip = np.where(fronts[:, 2:3] > 0, 1.0, -1.0)
    fronts *= flip[0]  # one sign for the whole arm: frames turn smoothly
    turn = -1.0 if left else 1.0
    # Raised most halfway to the elbow, not at all from the elbow on: the forearm stays
    # inside its sleeve.
    rise = np.sin(lift) * line.arc * np.clip(1.0 - line.arc / line.elbow, 0.0, 1.0) * 2.0
    raised = outs * rise[:, None]

    def place(flat: F64) -> F64:
        u, v = flat[:, 0], flat[:, 1]
        t = offset + (top_v - v)
        k = np.clip(t, 0.0, line.arc[-1])
        centre = np.stack(
            [np.interp(k, line.arc, points[:, d] + raised[:, d]) for d in range(3)], 1
        )
        # Past the ends, straight on along the end tangents.
        ends = np.where((t < 0)[:, None], tangent[0], tangent[-1])
        centre += (t - k)[:, None] * ends
        o = np.stack([np.interp(k, line.arc, outs[:, d]) for d in range(3)], 1)
        f = np.stack([np.interp(k, line.arc, fronts[:, d]) for d in range(3)], 1)
        radius = width(np.clip(v, 0.0, None)) / (2 * np.pi) + gap
        theta = turn * u / radius
        return centre + radius[:, None] * (np.cos(theta)[:, None] * o + np.sin(theta)[:, None] * f)

    return place


# -------------------------------------------------------------------------------- torso


def surface_profile(points: F64, x0: float, bottom: float, front: bool) -> tuple[F64, F64]:
    """Length along the body's surface from `bottom` (as `surface_length` walks it, over
    the convex hull of the sagittal slab at `x0`) and the height reached, both increasing:
    the pattern's v measures the first, the cloth is placed by the second."""
    slab = points[(np.abs(points[:, 0] - x0) < 0.008) & (points[:, 1] >= bottom)]
    if len(slab) < 3:
        raise GarmentError(f"no body at x = {x0:.3f}")
    hull = convex_hull(slab[:, [2, 1]])
    top = int(hull[:, 1].argmax())
    sign = 1.0 if front else -1.0
    low = hull[:, 1] < hull[:, 1].min() + 0.01
    start = int(np.flatnonzero(low)[np.argmax(sign * hull[low, 0])])
    k = len(hull)

    def walk(step: int) -> list[int]:
        path, i = [start], start
        while i != top:
            i = (i + step) % k
            path.append(i)
        return path

    paths = [walk(1), walk(-1)]
    path = max(paths, key=lambda q: sum(sign * hull[i, 0] for i in q[1:]))
    along = hull[path]
    arc = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(along, axis=0), axis=1))])
    rise = float(along[0, 1] - bottom)
    return np.concatenate([[0.0], rise + arc]), np.concatenate([[bottom], along[:, 1]])


def placed_by_height(place: Place, length: F64, height: F64, hem: float) -> Place:
    """`place` with each row put at the height its pattern v (a length over the surface)
    reaches on the body, not hem + v: over the chest and the shoulder blades the surface
    is longer than the height it climbs. Past the profile's top, straight up."""

    def remapped(flat: F64) -> F64:
        v = flat[:, 1]
        y = np.interp(v, length, height) + np.clip(v - length[-1], 0.0, None)
        return place(np.c_[flat[:, 0], y - hem])

    return remapped


def button_held(place: Place, point: F64, target: F64) -> Place:
    """`place` drawn smoothly to put the pattern `point` at `target` (falling off over
    BUTTON_REACH of pattern distance), where it is then held."""

    def held(flat: F64) -> F64:
        out = place(flat)
        shift = target - place(point[None])[0]
        weight = np.exp(-np.sum((flat - point) ** 2, axis=1) / (2 * BUTTON_REACH**2))
        return out + weight[:, None] * shift

    return held


def hanging_rings(
    trunk: F64,
    heights: F64,
    half_width: PchipInterpolator,
    cap: float,
    gap: float,
    fullest: float,
) -> list[Ring]:
    """`torso_rings` for woven cloth: under `fullest` (the chest) a ring is the hull of
    the torso from its height up to there, so the cloth starts hanging from the chest."""
    rings = []
    top_grow = gap
    for height in heights:
        h = float(height)
        if h <= cap:
            top = fullest if h < fullest else h
            band = trunk[(trunk[:, 1] >= h - SECTION) & (trunk[:, 1] <= top + SECTION)]
            hull = convex_hull(band[:, [0, 2]])
            perimeter = float(np.linalg.norm(np.roll(hull, -1, 0) - hull, axis=1).sum())
            grow = max(gap, (4.0 * float(half_width(h)) - perimeter) / (2 * np.pi))
            top_grow = grow
        else:
            band = trunk[(trunk[:, 1] >= cap - SECTION) & (trunk[:, 1] <= h + SECTION)]
            hull = convex_hull(band[:, [0, 2]])
            grow = top_grow
        rings.append(make_ring(offset_hull(hull, grow, 48), h, h > cap))
    return rings


@dataclass(frozen=True, eq=False)
class ShirtPattern:
    torso: TorsoPattern
    rise: float  # hem at the side seams
    vee_u: float  # the stand's front end on the front pattern
    vee_v: float
    vee_bottom: float  # v of the V's point
    dart: float  # intake (front only)
    dart_v: float


def _hem(p: ShirtPattern) -> F64:
    u = np.linspace(-p.torso.hem_half, p.torso.hem_half, 33)
    return np.stack([u, p.rise * np.abs(u / p.torso.hem_half) ** 2.2], 1)


def _side(p: ShirtPattern) -> tuple[F64, F64]:
    """The right side seam (u > 0) from the hem up, split at the dart's height (below,
    above; without a dart, at the same height)."""
    t = p.torso
    shape = PchipInterpolator(
        [p.rise, t.waist_v, t.underarm_v], [t.hem_half, t.waist_half, t.underarm_half]
    )
    low = np.linspace(p.rise, p.dart_v, 16)
    high = np.linspace(p.dart_v, t.underarm_v, 12)
    return (
        np.stack([shape(low), low], 1),
        np.stack([shape(high), high + p.dart], 1),
    )


def _arm(t: TorsoPattern, bottom: F64) -> F64:
    rise = t.shoulder_v - bottom[1]
    return bezier(
        bottom,
        np.array([t.shoulder_u + 0.15 * (bottom[0] - t.shoulder_u), bottom[1]]),
        np.array([t.shoulder_u - 0.004, bottom[1] + 0.4 * rise]),
        np.array([t.shoulder_u, t.shoulder_v]),
    )


def _flip(points: F64) -> F64:
    out = points[::-1].copy()
    out[:, 0] *= -1.0
    return out


def _half_ellipse_width(length: float, depth: float) -> float:
    """Half-width of a half-ellipse `depth` deep whose curve is `length` long."""
    low, high = 0.01, 0.3
    for _ in range(60):
        a = 0.5 * (low + high)
        b = depth
        curve = 0.5 * np.pi * (3 * (a + b) - np.sqrt((3 * a + b) * (a + 3 * b)))
        low, high = (a, high) if curve < length else (low, a)
    return 0.5 * (low + high)


def _neck_curve(t: TorsoPattern, end: tuple[float, float]) -> F64:
    """The front neckline from the side neck point down to the stand's front end."""
    u, v = end
    return bezier(
        np.array([t.neck_u, t.neck_v]),
        np.array([t.neck_u, t.neck_v - 0.45 * (t.neck_v - v)]),
        np.array([u + 0.45 * (t.neck_u - u), v]),
        np.array([u, v]),
        24,
    )


def _vee_u(t: TorsoPattern, vee_v: float, length: float) -> float:
    """u of the stand's front end that makes the front neckline `length` long (as far in
    as the centre allows)."""
    low, high = 0.005, t.neck_u
    for _ in range(50):
        u = 0.5 * (low + high)
        curve = _neck_curve(t, (u, vee_v))
        current = float(np.linalg.norm(np.diff(curve, axis=0), axis=1).sum())
        # Further in is longer.
        low, high = (low, u) if current < length else (u, high)
    return 0.5 * (low + high)


def front_outline(p: ShirtPattern) -> tuple[Segment, ...]:
    """Counter-clockwise; u > 0 is the wearer's left. The neck runs down from the side
    neck point to the stand's front end, then the V to its point and up again."""
    t = p.torso
    low, high = _side(p)
    side_segments: list[Segment] = [Segment("side_l_low", low)]
    if p.dart > 0:
        start, end = low[-1], high[0]
        apex = np.array([start[0] - DART_DEPTH_SHARE * t.underarm_half, start[1] + 0.5 * p.dart])
        side_segments += [
            Segment("dart_l_a", polyline(tuple(start), tuple(apex))),
            Segment("dart_l_b", polyline(tuple(apex), tuple(end))),
        ]
    side_segments.append(Segment("side_l_high", high))
    arm = _arm(t, high[-1])
    shoulder = polyline((t.shoulder_u, t.shoulder_v), (t.neck_u, t.neck_v))
    neck = _neck_curve(t, (p.vee_u, p.vee_v))
    vee = polyline((p.vee_u, p.vee_v), (0.0, p.vee_bottom))
    right = [
        Segment(s.name.replace("_l_", "_r_"), _flip(s.points)) for s in reversed(side_segments)
    ]
    return (
        Segment("hem", _hem(p)),
        *side_segments,
        Segment("arm_l", arm),
        Segment("shoulder_l", shoulder),
        Segment("neck_l", neck),
        Segment("vee_l", vee),
        Segment("vee_r", _flip(vee)),
        Segment("neck_r", _flip(neck)),
        Segment("shoulder_r", _flip(shoulder)),
        Segment("arm_r", _flip(arm)),
        *right,
    )


def back_outline(p: ShirtPattern) -> tuple[Segment, ...]:
    """Seen from behind, u > 0 is the wearer's right."""
    t = p.torso
    low, high = _side(p)
    arm = _arm(t, high[-1])
    shoulder = polyline((t.shoulder_u, t.shoulder_v), (t.neck_u, t.neck_v))
    angle = np.linspace(np.pi / 2, -np.pi / 2, 33)
    neck = np.stack([t.neck_u * np.sin(angle), t.neck_v - t.neck_drop * np.cos(angle)], 1)
    return (
        Segment("hem", _hem(p)),
        Segment("side_r_low", low),
        Segment("side_r_high", high),
        Segment("arm_r", arm),
        Segment("shoulder_r", shoulder),
        Segment("neck", neck),
        Segment("shoulder_l", _flip(shoulder)),
        Segment("arm_l", _flip(arm)),
        Segment("side_l_high", _flip(high)),
        Segment("side_l_low", _flip(low)),
    )


DART_DEPTH_SHARE = 0.45  # of the half-width at the armhole, how far in a dart points


@dataclass(frozen=True, eq=False)
class ShirtDraft:
    mesh: FlatMesh
    measures: Measures
    front: ShirtPattern
    back: ShirtPattern
    collar: Collar
    sleeve_top: float
    sleeve_length: float
    cuff_width: float
    pieces: tuple[Piece, ...] = ()

    def to_uv(self, name: str, points: F64) -> F64:
        """Pattern points of a piece (as drafted) in the UV atlas."""
        index = self.mesh.names.index(name)
        piece = self.pieces[index]
        outline_min = np.concatenate([s.points for s in piece.segments]).min(0)
        on = self.mesh.piece == index
        flat = self.mesh.flat[on]
        local = points - outline_min + flat.min(0)
        design = np.c_[flat, np.ones(len(flat))]
        affine, *_ = np.linalg.lstsq(design, self.mesh.uvs[on], rcond=None)
        return np.c_[local, np.ones(len(local))] @ affine

    def pattern(self, name: str) -> F64:
        """Pattern coordinates (as drafted) of every vertex of a piece."""
        index = self.mesh.names.index(name)
        outline_min = np.concatenate([s.points for s in self.pieces[index].segments]).min(0)
        on = self.mesh.piece == index
        return self.mesh.flat[on] - self.mesh.flat[on].min(0) + outline_min


def draft_shirt(body: BaseBody, neck: Neck, spec: ShirtSpec) -> ShirtDraft:
    m = measure(body, neck, spec)
    shoulders = body.limb & (body.positions[:, 1] > m.underarm)
    surface = np.concatenate([body.positions[~body.limb | shoulders], neck.positions])
    surface = surface[np.abs(surface[:, 0]) < 0.3]

    def half(girth: float, ease: float) -> float:
        return (girth + ease) / 4.0

    hem_half = half(m.girth_hem, spec.hem_ease)
    waist_half = half(m.girth_waist, spec.waist_ease)
    chest_half = half(m.girth_chest, spec.chest_ease)
    if spec.straight:
        hem_half = waist_half = chest_half = max(hem_half, waist_half, chest_half)
    neck_x = m.neck_radius + spec.neck_ease
    trunk = body.positions[~body.limb & (np.abs(body.positions[:, 0]) < 0.3)]
    hps = next(
        float(h)
        for h in np.arange(m.underarm, neck.seam_top + NECK_REACH, 0.002)
        if np.abs(_slab(surface, float(h), 0.003)[:, 0]).max(initial=0.0) <= neck_x
    )
    collar = collar_rings(closed_body(body, neck), neck, hps, spec)
    lengths = surface[surface[:, 1] <= hps]
    # The neckline on the pattern is cut to the collar: its back as long as the collar's
    # base round the back of the neck, its front down to the stand's ends.
    arc = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(collar.base, axis=0), axis=1))])
    side_y = float(np.interp(collar.sides[0], collar.share, collar.base[:, 1]))
    back_y = float(np.interp(0.5, collar.share, collar.base[:, 1]))
    back_drop = max(side_y - back_y, 0.005)
    back_arc = (collar.sides[1] - collar.sides[0]) * float(arc[-1])
    front_arc = collar.sides[0] * float(arc[-1])
    neck_u = _half_ellipse_width(back_arc, back_drop)
    above = max(side_y - hps, 0.0)

    def torso(front: bool) -> TorsoPattern:
        shoulder_v = surface_length(lengths, m.shoulder_x - 0.02, m.hem, front)
        neck_v = surface_length(lengths, min(neck_u, neck_x), m.hem, front) + above
        return TorsoPattern(
            hem_half=hem_half,
            waist_half=max(waist_half, 0.0),
            underarm_half=chest_half,
            waist_v=m.waist - m.hem,
            underarm_v=m.underarm - m.hem,
            shoulder_u=m.shoulder_x,
            shoulder_v=shoulder_v,
            neck_u=neck_u,
            neck_v=max(neck_v, shoulder_v + 0.005),
            neck_drop=back_drop,
        )

    front_t, back_t = torso(True), torso(False)
    # The stand's front end on the front pattern: as far under the side neck point as on
    # the body, and as far in as makes the front neckline as long as the collar's front.
    vee_v = front_t.neck_v - (side_y - float(collar.front_end[1]))
    vee_u = _vee_u(front_t, vee_v, front_arc)
    dart = spec.dart
    dart_v = front_t.underarm_v - spec.dart_below
    rise = spec.side_rise
    front = ShirtPattern(front_t, rise, vee_u, vee_v, vee_v - spec.vee, dart, dart_v)
    back = ShirtPattern(back_t, rise, 0.0, 0.0, 0.0, 0.0, dart_v)
    front_outline_ = front_outline(front)
    back_outline_ = back_outline(back)

    def length_of(outline: tuple[Segment, ...], name: str) -> float:
        return next(s for s in outline if s.name == name).length

    armhole = length_of(front_outline_, "arm_l") + length_of(back_outline_, "arm_l")
    width = m.bicep + spec.bicep_ease
    line = arm_line(body, m)
    cuff_width = line.wrist_girth + spec.cuff_ease
    offset = -0.02
    total = line.arc[-1] + spec.wrist_extra
    cap = _cap_height(width, 0.3, 0.5 * (armhole + spec.cap_ease))
    sleeve_length = total - offset - cap
    sleeve_top = sleeve_length + cap

    def sleeve_width(v: F64) -> F64:
        return cuff_width + (width - cuff_width) * np.clip(v / sleeve_length, 0.0, 1.0)

    width_at = PchipInterpolator(
        np.array([m.hem, m.waist, m.underarm]), np.array([hem_half, waist_half, chest_half])
    )
    top = m.hem + max(front_t.neck_v, back_t.neck_v) + 0.02
    heights = np.arange(m.hem - 0.01, top + 0.005, 0.005)
    # Woven cloth hangs from the chest: below its fullest point each ring is the hull of
    # the torso from that height up to it (started on its own section, the cloth keeps
    # the waist's shape, as jersey does).
    chest = trunk[(np.abs(trunk[:, 0]) < 0.15) & (np.abs(trunk[:, 1] - m.underarm) < 0.1)]
    fullest = float(chest[chest[:, 2].argmax(), 1])
    rings = hanging_rings(trunk, heights, width_at, m.underarm, spec.torso_gap, fullest)
    collar_length = float(np.sum(np.linalg.norm(np.diff(collar.base, axis=0), axis=1)))
    split = (collar.sides[0] * collar_length, collar.sides[1] * collar_length)
    stand_height = spec.stand
    fall_height = spec.stand + spec.fall_point
    stand_share = np.linalg.norm(collar.middle - collar.fold, axis=1) / (
        np.linalg.norm(collar.middle - collar.fold, axis=1)
        + np.linalg.norm(collar.outer - collar.middle, axis=1)
    )
    # The first closed button: the V's point held on the chest under the collar's ends
    # (left free, the cloth bridging from the chest to the collar pulls the V shut).
    button_y = float(collar.front_end[1]) - spec.vee_drop
    centre_z = 0.5 * float(collar.base[:, 2].max() + collar.base[:, 2].min())
    hit, normal = _surface_hits(
        *closed_body(body, neck), centre_z, np.array([button_y]), np.array([0.0])
    )
    button = hit[0] + BUTTON_LIFT * normal[0]
    profile_x = 0.5 * neck_u
    front_profile = surface_profile(lengths, profile_x, m.hem, True)
    back_profile = surface_profile(lengths, profile_x, m.hem, False)
    lift = np.radians(spec.sleeve_lift)
    pieces = [
        Piece(
            FRONT,
            front_outline_,
            button_held(
                placed_by_height(
                    torso_place(rings, m.hem, True, chest_half), *front_profile, m.hem
                ),
                np.array([0.0, front.vee_bottom]),
                button,
            ),
        ),
        Piece(
            BACK,
            back_outline_,
            placed_by_height(torso_place(rings, m.hem, False, chest_half), *back_profile, m.hem),
        ),
        Piece(
            SLEEVE_L,
            tuple(_sleeve(SLEEVE_L, width, cuff_width, sleeve_length, cap)),
            bent_sleeve_place(line, sleeve_top, offset, lift, sleeve_width, spec.sleeve_gap, False),
        ),
        Piece(
            SLEEVE_R,
            tuple(_sleeve(SLEEVE_R, width, cuff_width, sleeve_length, cap)),
            bent_sleeve_place(line, sleeve_top, offset, lift, sleeve_width, spec.sleeve_gap, True),
        ),
        Piece(
            STAND,
            (
                Segment("base_l", polyline((0.0, 0.0), (split[0], 0.0))),
                Segment("base_back", polyline((split[0], 0.0), (split[1], 0.0))),
                Segment("base_r", polyline((split[1], 0.0), (collar_length, 0.0))),
                Segment("end_r", polyline((collar_length, 0.0), (collar_length, stand_height))),
                Segment("top", polyline((collar_length, stand_height), (0.0, stand_height))),
                Segment("end_l", polyline((0.0, stand_height), (0.0, 0.0))),
            ),
            stand_place(collar, collar_length, stand_height),
        ),
        Piece(
            FALL,
            (
                Segment("edge", polyline((0.0, 0.0), (collar_length, 0.0))),
                Segment("point_r", polyline((collar_length, 0.0), (collar_length, fall_height))),
                Segment("fold", polyline((collar_length, fall_height), (0.0, fall_height))),
                Segment("point_l", polyline((0.0, fall_height), (0.0, 0.0))),
            ),
            fall_place(collar, collar_length, fall_height, stand_share),
        ),
    ]
    seams = [
        Seam(FRONT, "side_l_low", BACK, "side_l_low"),
        Seam(FRONT, "side_l_high", BACK, "side_l_high"),
        Seam(FRONT, "side_r_low", BACK, "side_r_low"),
        Seam(FRONT, "side_r_high", BACK, "side_r_high"),
        Seam(FRONT, "shoulder_l", BACK, "shoulder_l"),
        Seam(FRONT, "shoulder_r", BACK, "shoulder_r"),
        Seam(SLEEVE_L, "under_a", SLEEVE_L, "under_b"),
        Seam(SLEEVE_R, "under_a", SLEEVE_R, "under_b"),
        Seam(FRONT, "neck_l", STAND, "base_l"),
        Seam(BACK, "neck", STAND, "base_back"),
        Seam(FRONT, "neck_r", STAND, "base_r"),
        Seam(STAND, "top", FALL, "fold"),
    ]
    if dart > 0:
        seams += [
            Seam(FRONT, "dart_l_a", FRONT, "dart_l_b"),
            Seam(FRONT, "dart_r_a", FRONT, "dart_r_b"),
        ]
    for sleeve, side in ((pieces[2], "l"), (pieces[3], "r")):
        mid = sleeve.segment("cap_a").points[len(sleeve.segment("cap_a").points) // 2]
        cap_a_front = sleeve.place(mid[None])[0, 2] > m.shoulder[2]
        front_half, back_half = ("cap_a", "cap_b") if cap_a_front else ("cap_b", "cap_a")
        seams.append(Seam(FRONT, f"arm_{side}", sleeve.name, front_half))
        seams.append(Seam(BACK, f"arm_{side}", sleeve.name, back_half))
    mesh = layout(pieces, seams, spec.spacing, turn_uv=True)
    draft = ShirtDraft(
        mesh, m, front, back, collar, sleeve_top, sleeve_length, cuff_width, tuple(pieces)
    )

    collar_piece = np.isin(mesh.piece, [mesh.names.index(STAND), mesh.names.index(FALL)])
    pin = collar_piece.astype(np.float64)
    on_front = mesh.piece == mesh.names.index(FRONT)
    held = np.linalg.norm(draft.pattern(FRONT) - np.array([0.0, front.vee_bottom]), axis=1)
    pin[on_front] = np.clip((BUTTON_HOLD - held) / (0.5 * BUTTON_HOLD), 0.0, 1.0)
    hems = [(FRONT, "hem"), (BACK, "hem")]
    cuffs = [(SLEEVE_L, "hem"), (SLEEVE_R, "hem")]
    placket = np.zeros(len(mesh.flat))
    pattern = draft.pattern(FRONT)
    placket[on_front] = np.clip(1.5 - np.abs(pattern[:, 0]) / (0.5 * spec.placket), 0.0, 1.0) * (
        pattern[:, 1] < front.vee_bottom + 0.01
    )
    stiff = np.maximum.reduce(
        [
            mesh.band(hems, spec.hem_band),
            mesh.band(cuffs, spec.cuff),
            mesh.band([(FRONT, "vee_l"), (FRONT, "vee_r")], 0.5 * spec.placket),
            placket,
            collar_piece.astype(np.float64),
        ]
    )
    trunk_at = trunk[np.abs(trunk[:, 1] - m.underarm) < SECTION]
    side = float(np.abs(trunk_at[:, 0]).max())
    depth = float(np.median(trunk_at[np.abs(trunk_at[:, 0]) > side - 0.03, 2]))
    pits = tuple(
        (sign * side, m.underarm + rise_, depth) for sign in (1.0, -1.0) for rise_ in (0.02, -0.05)
    )
    # And the front fold of the armpit: a lowered arm swells the chest's side there, out
    # through roomy cloth that hangs off it.
    pits += tuple(
        (sign * (side - 0.01), m.underarm - 0.04, depth + AXILLA_FRONT) for sign in (1.0, -1.0)
    )
    mesh = replace(
        mesh,
        pin=pin,
        stiff=stiff,
        hug=pits,
        arm=arm_share(mesh, spec.arm_band, front_t.underarm_v),
    )
    return replace(draft, mesh=mesh)


# ------------------------------------------------------------------------------ details


def _inset(line: F64, distance: float) -> F64:
    return offset_line(resample(line, max(len(line), 2)), distance)


def _button_holes_and_buttons(
    draft: ShirtDraft, spec: ShirtSpec, mm: float
) -> tuple[list[F64], list[F64], list[tuple[float, float, float]]]:
    """The closed placket under the V: its lapped edge, its topstitching and the buttons
    down the centre front."""
    front = draft.front
    sign = -1.0 if spec.left_over_right else 1.0  # where the top layer's edge shows
    half = 0.5 * spec.placket
    top, bottom = front.vee_bottom, 0.004
    edges = [polyline((sign * half, top), (sign * half, bottom))]
    stitches = [
        polyline((sign * (half - 0.003), top), (sign * (half - 0.003), bottom)),
        polyline((-sign * (half - 0.003), top), (-sign * (half - 0.003), bottom)),
    ]
    buttons = []
    v = top - 0.012
    while v > 0.08:
        buttons.append((0.0, v))
        v -= BUTTON_PITCH
    uv = (
        [draft.to_uv(FRONT, line) for line in edges],
        [draft.to_uv(FRONT, line) for line in stitches],
    )
    centres = draft.to_uv(FRONT, np.array(buttons)) if buttons else np.zeros((0, 2))
    radius = BUTTON_RADIUS * 1000 * mm
    return uv[0], uv[1], [(float(u), float(v), radius) for u, v in centres]


def shirt_lines(draft: ShirtDraft, spec: ShirtSpec) -> GarmentLines:
    """Seams and finished edges, the closed placket and its buttons, topstitched V edges,
    the back yoke, cuffs with a button and a placket slit, collar edge stitching and, on
    men's shirts, a chest pocket."""
    mesh = draft.mesh
    uv = mesh.uvs
    mm = 0.001 / mesh.uv_metres

    def run(piece: str, segment: str) -> F64:
        return uv[mesh.segments[(piece, segment)]]

    seams, edges, stitches, raised = [], [], [], []
    for key, vertices in mesh.segments.items():
        (seams if mesh.sewn(*key) else edges).append(uv[vertices])
    placket_edges, placket_stitches, buttons = _button_holes_and_buttons(draft, spec, mm)
    edges += placket_edges
    stitches += placket_stitches
    for segment in ("vee_l", "vee_r"):
        line = run(FRONT, segment)
        stitches.append(_inset(line, 3.0 * mm))
        stitches.append(_inset(line, (spec.placket * 1000 - 3.0) * mm))
    # The back yoke: a seam across the shoulders.
    back = draft.back.torso
    yoke_v = back.neck_v - 0.1
    yoke = polyline((-0.85 * back.shoulder_u, yoke_v), (0.85 * back.shoulder_u, yoke_v))
    seams.append(draft.to_uv(BACK, yoke))
    stitches.append(draft.to_uv(BACK, yoke - np.array([0.0, 0.003])))
    for hem_piece in (FRONT, BACK):
        stitches.append(_inset(run(hem_piece, "hem"), 4.0 * mm))
    for sleeve in (SLEEVE_L, SLEEVE_R):
        hem = run(sleeve, "hem")
        seams.append(_inset(hem, spec.cuff * 1000 * mm))
        stitches.append(_inset(hem, 3.0 * mm))
        stitches.append(_inset(hem, (spec.cuff * 1000 - 3.0) * mm))
        half = 0.5 * draft.cuff_width
        # The sleeve placket's slit above the cuff and the cuff's button, toward the back.
        u = 0.5 * half
        edges.append(draft.to_uv(sleeve, polyline((u, spec.cuff), (u, spec.cuff + 0.12))))
        centre = draft.to_uv(sleeve, np.array([[u + 0.012, 0.5 * spec.cuff]]))[0]
        buttons.append((float(centre[0]), float(centre[1]), BUTTON_RADIUS * 1000 * mm))
    for segment in ("edge", "point_l", "point_r"):
        stitches.append(_inset(run(FALL, segment), 3.0 * mm))
    stitches.append(_inset(run(STAND, "top"), 3.0 * mm))
    if spec.pocket:
        t = draft.front.torso
        top = t.underarm_v + 0.02
        left, right = 0.045, 0.045 + 0.115
        bottom = top - 0.13
        pocket = polyline(
            (left, top),
            (left, bottom + 0.015),
            (0.5 * (left + right), bottom),
            (right, bottom + 0.015),
            (right, top),
        )
        raised.append(draft.to_uv(FRONT, pocket))
        stitches.append(draft.to_uv(FRONT, _inset(pocket, 0.002)))
        stitches.append(draft.to_uv(FRONT, polyline((left, top - 0.02), (right, top - 0.02))))
    return GarmentLines(
        seams=seams,
        edges=edges,
        stitches=stitches,
        raised=raised,
        buttons=buttons,
        stitch_strength=0.35,
        seam_shadow=0.25,
    )
