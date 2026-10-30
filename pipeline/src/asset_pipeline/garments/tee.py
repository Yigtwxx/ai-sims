"""Crew-neck T-shirt drafted to the outfit-base body as a flat pattern.

Pieces: front, back and two set-in short sleeves. Widths come from the body's girths plus
ease, lengths from its surface (the convex hull of a sagittal slab of the body and neck,
so the cloth bridges the bust and the hollows by the neck as fabric does). The front and
back start wrapped on rings round the torso (`torso_rings`), the sleeves on a cylinder
around each upper arm; the sewing springs close the side, shoulder, underarm and armhole
seams, then gravity settles the shirt on the shoulders.
"""

from dataclasses import dataclass, replace

import numpy as np
from scipy.interpolate import PchipInterpolator

from asset_pipeline.garments import GarmentError
from asset_pipeline.garments.body import BaseBody, convex_hull, landmarks, offset_hull
from asset_pipeline.garments.collider import Neck
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
from asset_pipeline.garments.pattern import ray_hit

FRONT = "front"
BACK = "back"
SLEEVE_L = "sleeve_l"  # the wearer's left (+x)
SLEEVE_R = "sleeve_r"
NECK_REACH = 0.06  # metres above the neck seam searched for the neck
SECTION = 0.008  # half-height of a body slab (m)
SQUEEZE = 0.85  # how far toward a ring's side the pieces start above the armhole
SQUEEZE_RISE = 0.06  # metres over which that narrowing comes in
SQUEEZE_KEEP = 0.5  # share of the half-width, from the centre, left as cut
RIB_PITCH = 2.5  # millimetres between a neckband's rib wales
ARM_BAND = 0.07  # metres of torso cloth from the armhole that partly follow the arm
UNDERARM_FADE = 0.03  # metres above the armhole bottom over which that comes in
ARM_SEAM_SHARE = 2.0 / 3.0  # smoothstep of this (~0.74): the torso's share on the armhole


@dataclass(frozen=True)
class TeeSpec:
    name: str = "AS_CrewTee"
    hem_above_hip: float = 0.035  # metres above the widest hip
    underarm_drop: float = 0.035  # armhole bottom below the armpit
    chest_ease: float = 0.08  # girth ease (metres of circumference)
    waist_ease: float = 0.30
    hem_ease: float = 0.07
    straight: bool = False  # side seams straight down from the chest (men's cut)
    bust: bool = True  # a dartless front over a bust: cut no longer than the back
    shoulder_out: float = 0.045  # shoulder point beyond the shoulder joint, in x
    neck_ease: float = 0.03  # neck side point beyond the neck, in x
    front_neck_drop: float = 0.095
    back_neck_drop: float = 0.025
    sleeve_length: float = 0.08  # underarm seam
    bicep_ease: float = 0.08  # girth ease of the sleeve
    sleeve_hem_taper: float = 0.015
    cap_ease: float = 0.012  # sleeve cap longer than the armhole
    rib: float = 0.018  # neckband height
    hem_band: float = 0.022  # coverstitched hem turn-up
    spacing: float = 0.012  # cloth edge length
    torso_gap: float = 0.012  # start of the simulation: rings outside the torso
    sleeve_gap: float = 0.03
    sleeve_lift: float = 8.0  # degrees the sleeves start raised, to clear the torso
    arm_band: float = 0.07  # metres of torso cloth from the armhole that partly follow the arm
    arm_weights: bool = True  # sleeves follow the arm only (`ARM_ATTRIBUTE`)


TEE_FEMALE = TeeSpec(hem_above_hip=0.05)
TEE_MALE = TeeSpec(
    hem_above_hip=0.015,
    underarm_drop=0.045,
    chest_ease=0.10,
    waist_ease=0.20,
    hem_ease=0.10,
    straight=True,
    bust=False,
    front_neck_drop=0.10,
    back_neck_drop=0.022,
    sleeve_length=0.13,
    bicep_ease=0.06,
    rib=0.02,
    arm_band=0.09,
)


@dataclass(frozen=True)
class Measures:
    hem: float  # heights (m)
    waist: float
    underarm: float
    girth_hem: float  # torso hull perimeters (m)
    girth_waist: float
    girth_chest: float
    bicep: float  # upper arm girth below the armpit
    neck_radius: float  # half the neck's width above the seam
    shoulder_x: float  # shoulder point
    shoulder: F64  # the left upper arm's centre line, at the shoulder joint
    elbow: F64  # and at the elbow


def _slab(points: F64, height: float, band: float = 0.008) -> F64:
    return points[np.abs(points[:, 1] - height) < band]


def _girth(points: F64, height: float) -> float:
    slab = _slab(points, height)
    hull = convex_hull(slab[:, [0, 2]])
    return float(np.linalg.norm(np.roll(hull, -1, 0) - hull, axis=1).sum())


def armpit(body: BaseBody, start: float, step: float = 0.005) -> float:
    """Lowest height above `start` where the left arm's skin meets the torso's."""
    limb = body.limb if body.limb is not None else body.arm
    torso = body.positions[~limb & (np.abs(body.positions[:, 0]) < 0.3)]
    arm = body.positions[limb & (body.positions[:, 0] > 0)]
    for height in np.arange(start, body.top, step):
        t, a = _slab(torso, height), _slab(arm, height)
        if len(t) and len(a) and a[:, 0].min() - t[:, 0].max() < 0.005:
            return float(height)
    raise GarmentError("no armpit: the arms never meet the torso")


def arm_slice(arm: F64, shoulder: F64, elbow: F64, share: float) -> tuple[F64, float]:
    """Centre and girth of the upper arm across its axis, `share` of the way from the
    shoulder joint to the elbow: the box of its skin in the slab (the slab's plane also
    cuts the forearm and hand, further out) and the ellipse that fills it."""
    axis = (elbow - shoulder) / np.linalg.norm(elbow - shoulder)
    out = np.cross(axis, [0.0, 0.0, 1.0])
    out /= np.linalg.norm(out)
    front = np.cross(out, axis)
    center = shoulder + share * np.linalg.norm(elbow - shoulder) * axis
    rel = arm[np.abs((arm - center) @ axis) < 0.006] - center
    flat = np.stack([rel @ out, rel @ front], 1)
    flat = flat[np.linalg.norm(flat, axis=1) < 0.12]
    if len(flat) < 8:
        raise GarmentError("no upper arm to measure")
    lo, hi = flat.min(0), flat.max(0)
    middle = 0.5 * (lo + hi)
    width, depth = hi - lo
    return center + middle[0] * out + middle[1] * front, float(np.pi * 0.5 * (width + depth))


def measure(body: BaseBody, neck: Neck, spec: TeeSpec) -> Measures:
    if body.limb is None or "upperarm_l" not in body.joints:
        raise GarmentError("the base body has no joints")
    marks = landmarks(body)
    torso = body.positions[~body.limb & (np.abs(body.positions[:, 0]) < 0.3)]
    pit = armpit(body, marks.waist)
    underarm = pit - spec.underarm_drop
    hem = marks.hip + spec.hem_above_hip
    chest = max(_girth(torso, h) for h in np.arange(marks.waist, pit, 0.01))
    shoulder = body.joints["upperarm_l"]
    elbow = body.joints["lowerarm_l"]
    # The upper arm's own centre line: the joints run off it (by 3 cm in the man's arm).
    arm = body.positions[body.limb & (body.positions[:, 0] > 0)]
    length = float(np.linalg.norm(elbow - shoulder))
    near, _ = arm_slice(arm, shoulder, elbow, 0.3)
    far, _ = arm_slice(arm, shoulder, elbow, 0.7)
    _, bicep = arm_slice(arm, shoulder, elbow, 0.5)
    direction = (far - near) / np.linalg.norm(far - near)
    arm_start = near - 0.3 * length * direction
    # The neck's narrowest width above the seam (lower down the head mesh still spreads
    # over the shoulders).
    widths = [
        np.abs(slab[:, 0]).max()
        for h in np.arange(neck.seam_top, neck.seam_top + NECK_REACH, 0.005)
        if len(slab := _slab(neck.positions, float(h), 0.004))
    ]
    if not widths:
        raise GarmentError("no neck above the seam")
    return Measures(
        hem=hem,
        waist=marks.waist,
        underarm=underarm,
        girth_hem=_girth(torso, hem),
        girth_waist=_girth(torso, marks.waist),
        girth_chest=chest,
        bicep=bicep,
        neck_radius=float(min(widths)),
        shoulder_x=float(shoulder[0] + spec.shoulder_out),
        shoulder=arm_start,
        elbow=arm_start + length * direction,
    )


def surface_length(points: F64, x0: float, bottom: float, front: bool) -> float:
    """Length over the convex hull of the body's sagittal slab at `x0` from `bottom` (on
    the front or back) up to its highest point."""
    slab = points[(np.abs(points[:, 0] - x0) < 0.008) & (points[:, 1] >= bottom)]
    if len(slab) < 3:
        raise GarmentError(f"no body at x = {x0:.3f}")
    hull = convex_hull(slab[:, [2, 1]])  # (z, y)
    top = int(hull[:, 1].argmax())
    sign = 1.0 if front else -1.0
    # The slab may start above `bottom` (beside the waist): rise straight up to it.
    low = hull[:, 1] < hull[:, 1].min() + 0.01
    start = int(np.flatnonzero(low)[np.argmax(sign * hull[low, 0])])
    rise = float(hull[start, 1] - bottom)
    k = len(hull)

    def walk(step: int) -> tuple[float, float]:
        total, side, i = 0.0, 0.0, start
        while i != top:
            j = (i + step) % k
            total += float(np.linalg.norm(hull[j] - hull[i]))
            side += sign * float(hull[j, 0])
            i = j
        return total, side

    paths = [walk(1), walk(-1)]
    # The path on the wanted side has its points further toward it.
    return rise + max(paths, key=lambda p: p[1])[0]


@dataclass(frozen=True, eq=False)
class TorsoPattern:
    hem_half: float
    waist_half: float
    underarm_half: float
    waist_v: float
    underarm_v: float
    shoulder_u: float
    shoulder_v: float
    neck_u: float
    neck_v: float
    neck_drop: float


def _outline(p: TorsoPattern, sides: tuple[str, str]) -> tuple[Segment, ...]:
    """Counter-clockwise outline; `sides` names the body side of u > 0 and of u < 0."""
    right, left = sides
    vs = np.array([0.0, p.waist_v, p.underarm_v])
    us = np.array([p.hem_half, p.waist_half, p.underarm_half])
    v = np.linspace(0.0, p.underarm_v, 24)
    side = np.stack([PchipInterpolator(vs, us)(v), v], 1)
    rise = p.shoulder_v - p.underarm_v
    arm = bezier(
        np.array([p.underarm_half, p.underarm_v]),
        np.array([p.shoulder_u + 0.15 * (p.underarm_half - p.shoulder_u), p.underarm_v]),
        np.array([p.shoulder_u - 0.004, p.underarm_v + 0.4 * rise]),
        np.array([p.shoulder_u, p.shoulder_v]),
    )
    shoulder = polyline((p.shoulder_u, p.shoulder_v), (p.neck_u, p.neck_v))
    angle = np.linspace(np.pi / 2, -np.pi / 2, 33)
    neck = np.stack([p.neck_u * np.sin(angle), p.neck_v - p.neck_drop * np.cos(angle)], 1)

    def flip(points: F64) -> F64:
        out = points[::-1].copy()
        out[:, 0] *= -1.0
        return out

    hem = polyline((-p.hem_half, 0.0), (p.hem_half, 0.0))
    return (
        Segment("hem", hem),
        Segment(f"side_{right}", side),
        Segment(f"arm_{right}", arm),
        Segment(f"shoulder_{right}", shoulder),
        Segment("neck", neck),
        Segment(f"shoulder_{left}", flip(shoulder)),
        Segment(f"arm_{left}", flip(arm)),
        Segment(f"side_{left}", flip(side)),
    )


@dataclass(frozen=True, eq=False)
class Ring:
    """A closed (x, z) curve round the torso at one height, by arc length from the centre
    front toward +x."""

    height: float
    points: F64  # (K, 2), points[0] at the centre front
    arc: F64  # (K,) arc length of each point
    back: float  # arc length of the centre back
    above: bool = False  # above the armhole bottom: pieces are narrowed to clear the arms

    @property
    def perimeter(self) -> float:
        return float(self.arc[-1])

    def side(self, toward_plus_x: bool) -> float:
        """Arc length of the ring's +x (or -x) extreme."""
        x = self.points[:, 0]
        return float(self.arc[x.argmax() if toward_plus_x else x.argmin()])

    def at(self, s: F64) -> F64:
        s = np.mod(s, self.perimeter)
        return np.stack([np.interp(s, self.arc, self.points[:, d]) for d in (0, 1)], 1)


def make_ring(hull: F64, height: float, above: bool = False, samples: int = 720) -> Ring:
    center = hull.mean(0)
    front, i, _ = ray_hit(hull, center, np.array([0.0, 1.0]))
    # Walk the hull from the centre front the way x grows first.
    k = len(hull)
    order = [(i + 1 + n) % k for n in range(k)]
    loop = np.concatenate([[front], hull[order], [front]])
    if loop[1 : len(loop) // 4, 0].mean() < loop[0, 0]:
        loop = loop[::-1]
    steps = np.linalg.norm(np.diff(loop, axis=0), axis=1)
    arc = np.concatenate([[0.0], np.cumsum(steps)])
    even = np.linspace(0.0, arc[-1], samples + 1)
    points = np.stack([np.interp(even, arc, loop[:, d]) for d in (0, 1)], 1)
    back_point, _, _ = ray_hit(hull, center, np.array([0.0, -1.0]))
    back = float(even[np.linalg.norm(points - back_point, axis=1).argmin()])
    return Ring(height, points, even, back, above)


def torso_rings(
    torso: F64, heights: F64, half_width: PchipInterpolator, cap: float, gap: float
) -> list[Ring]:
    """Rings outside the torso: below `cap` each slab's hull grown so a quarter of it is the
    pattern's half-width there (the side seams then start together), above it the hull of
    everything from `cap` up, grown by `gap`."""
    rings = []
    top_grow = gap
    for height in heights:
        if height <= cap:
            hull = convex_hull(_slab(torso, float(height))[:, [0, 2]])
            perimeter = float(np.linalg.norm(np.roll(hull, -1, 0) - hull, axis=1).sum())
            grow = max(gap, (4.0 * float(half_width(height)) - perimeter) / (2 * np.pi))
            top_grow = grow
        else:
            band = torso[(torso[:, 1] >= cap - SECTION) & (torso[:, 1] <= height + SECTION)]
            hull = convex_hull(band[:, [0, 2]])
            grow = top_grow
        rings.append(make_ring(offset_hull(hull, grow, 48), float(height), height > cap))
    return rings


def torso_place(rings: list[Ring], hem: float, front: bool, widest: float) -> Place:
    """Front u runs from the centre front to +x; the back's (seen from behind) from the
    centre back to -x. Heights between rings blend the two. Above the armhole bottom the
    piece (at most `widest` from its centre) is narrowed to reach SQUEEZE of the way to
    the ring's side, so its armhole starts in front of (or behind) the arm."""
    heights = np.array([r.height for r in rings])

    cap = min((r.height for r in rings if r.above), default=np.inf)

    def arc(ring: Ring, u: F64) -> F64:
        if ring.above:
            if front:
                reach = np.where(u >= 0, ring.side(True), ring.perimeter - ring.side(False))
            else:
                reach = np.where(u >= 0, ring.side(False) - ring.back, ring.back - ring.side(True))
            # Only the outer part toward the armhole is drawn in (the middle of the back
            # stays as cut), gradually over SQUEEZE_RISE so no row starts sheared.
            t = min(1.0, (ring.height - cap) / SQUEEZE_RISE)
            share = t * t * (3.0 - 2.0 * t)
            keep = SQUEEZE_KEEP * widest
            target = np.minimum(widest, SQUEEZE * reach)
            k = np.clip((target - keep) / (widest - keep), 0.0, 1.0)
            k = 1.0 - share * (1.0 - k)
            a = np.abs(u)
            u = np.sign(u) * np.where(a <= keep, a, keep + (a - keep) * k)
        return u if front else ring.back + u

    def place(flat: F64) -> F64:
        u, v = flat[:, 0], flat[:, 1]
        y = hem + v
        out = np.empty((len(flat), 3))
        k = np.clip(np.searchsorted(heights, y) - 1, 0, len(rings) - 2)
        w = np.clip((y - heights[k]) / (heights[k + 1] - heights[k]), 0.0, 1.0)
        for index in np.unique(k):
            sel = k == index
            lo, hi = rings[index], rings[index + 1]
            xz = (1 - w[sel])[:, None] * lo.at(arc(lo, u[sel])) + w[sel][:, None] * hi.at(
                arc(hi, u[sel])
            )
            out[sel, 0], out[sel, 2] = xz[:, 0], xz[:, 1]
        out[:, 1] = y
        return out

    return place


def sleeve_place(
    shoulder: F64, elbow: F64, radius: float, top_v: float, offset: float, lift: float
) -> Place:
    """Wrap a sleeve round the upper arm: u around (the underarm seam inside, toward the
    torso), v up the arm to the cap, which starts `offset` along the arm from the joint.
    The axis is raised by `lift` radians so the start clears the torso."""
    left = shoulder[0] > 0
    axis = elbow - shoulder
    axis /= np.linalg.norm(axis)
    up = np.array([0.0, 1.0, 0.0])
    out = up - (up @ axis) * axis
    out /= np.linalg.norm(out)
    # Rotate the axis up toward `out` (in the arm's vertical plane).
    axis, out = (
        np.cos(lift) * axis + np.sin(lift) * out,
        np.cos(lift) * out - np.sin(lift) * axis,
    )
    front = np.cross(out, axis) if left else np.cross(axis, out)
    front = front if front[2] > 0 else -front
    turn = -1.0 if left else 1.0  # keeps the faces' winding outward

    def place(flat: F64) -> F64:
        u, v = flat[:, 0], flat[:, 1]
        theta = turn * u / radius
        t = offset + (top_v - v)
        ring = np.cos(theta)[:, None] * out + np.sin(theta)[:, None] * front
        return shoulder + t[:, None] * axis + radius * ring

    return place


def _sleeve(name: str, width: float, hem_width: float, length: float, cap: float) -> list:
    """Sleeve outline: hem, underarm seam (u > 0), cap halves, underarm seam (u < 0)."""
    top = length + cap
    half, hem_half = width / 2, hem_width / 2
    cap_a = bezier(
        np.array([half, length]),
        np.array([0.62 * half, length + 0.12 * cap]),
        np.array([0.36 * half, top]),
        np.array([0.0, top]),
    )
    cap_b = cap_a[::-1].copy()
    cap_b[:, 0] *= -1.0
    return [
        Segment("hem", polyline((-hem_half, 0.0), (hem_half, 0.0))),
        Segment("under_a", polyline((hem_half, 0.0), (half, length))),
        Segment("cap_a", cap_a),
        Segment("cap_b", cap_b),
        Segment("under_b", polyline((-half, length), (-hem_half, 0.0))),
    ]


def _cap_height(width: float, length: float, target: float) -> float:
    """Cap height whose half-curve is `target` long."""
    low, high = 0.01, 0.4
    for _ in range(50):
        mid = 0.5 * (low + high)
        half = _sleeve("", width, width, length, mid)[2]
        if half.length < target:
            low = mid
        else:
            high = mid
    return 0.5 * (low + high)


@dataclass(frozen=True, eq=False)
class TeeDraft:
    mesh: FlatMesh
    measures: Measures
    front: TorsoPattern
    back: TorsoPattern
    sleeve_top: float  # flat v of the cap top
    sleeve_length: float


def draft_tee(body: BaseBody, neck: Neck, spec: TeeSpec) -> TeeDraft:
    m = measure(body, neck, spec)
    # The torso, the neck and the tops of the shoulders (the arm's skin above the armhole).
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
    # The neck side point: where the shoulder slope, narrowing upward, meets the neck. The
    # neck above it is left out of the lengths.
    hps = next(
        float(h)
        for h in np.arange(m.underarm, neck.seam_top + NECK_REACH, 0.002)
        if np.abs(_slab(surface, float(h), 0.003)[:, 0]).max(initial=0.0) <= neck_x
    )
    surface = surface[surface[:, 1] <= hps]

    def torso(front: bool) -> TorsoPattern:
        shoulder_v = surface_length(surface, m.shoulder_x - 0.02, m.hem, front)
        neck_v = surface_length(surface, neck_x, m.hem, front)
        return TorsoPattern(
            hem_half=hem_half,
            waist_half=max(waist_half, 0.0),
            underarm_half=chest_half,
            waist_v=m.waist - m.hem,
            underarm_v=m.underarm - m.hem,
            shoulder_u=m.shoulder_x,
            shoulder_v=shoulder_v,
            neck_u=neck_x,
            neck_v=max(neck_v, shoulder_v + 0.005),
            neck_drop=spec.front_neck_drop if front else spec.back_neck_drop,
        )

    front, back = torso(True), torso(False)
    if spec.bust:
        # The front's shoulder seam slopes like the back's. Measured over the bust the
        # front would be cut longer in the middle; the jersey stretches there instead, and
        # a piece cut that long gathers in rolls under the bust.
        front = replace(front, neck_v=front.shoulder_v + (back.neck_v - back.shoulder_v))
    front_outline = _outline(front, ("l", "r"))  # front u > 0 is the wearer's left
    back_outline = _outline(back, ("r", "l"))
    armhole = (
        next(s for s in front_outline if s.name == "arm_l").length
        + next(s for s in back_outline if s.name == "arm_l").length
    )
    width = m.bicep + spec.bicep_ease
    cap = _cap_height(width, spec.sleeve_length, 0.5 * (armhole + spec.cap_ease))
    sleeve_top = spec.sleeve_length + cap

    # Starting shapes. The torso cylinder clears the torso up to the underarm, and its
    # quarter perimeter is the widest half-piece, so the side seams start close.
    trunk = body.positions[~body.limb & (np.abs(body.positions[:, 0]) < 0.3)]
    width_at = PchipInterpolator(
        np.array([m.hem, m.waist, m.underarm]), np.array([hem_half, waist_half, chest_half])
    )
    top = m.hem + max(front.neck_v, back.neck_v) + 0.02
    heights = np.arange(m.hem - 0.01, top + 0.005, 0.005)
    rings = torso_rings(trunk, heights, width_at, m.underarm, spec.torso_gap)
    radius = width / (2 * np.pi) + spec.sleeve_gap
    mirror = np.array([-1.0, 1.0, 1.0])
    pieces = [
        Piece(FRONT, front_outline, torso_place(rings, m.hem, True, chest_half)),
        Piece(BACK, back_outline, torso_place(rings, m.hem, False, chest_half)),
        Piece(
            SLEEVE_L,
            tuple(_sleeve(SLEEVE_L, width, width - spec.sleeve_hem_taper, spec.sleeve_length, cap)),
            sleeve_place(
                m.shoulder, m.elbow, radius, sleeve_top, -0.02, np.radians(spec.sleeve_lift)
            ),
        ),
        Piece(
            SLEEVE_R,
            tuple(_sleeve(SLEEVE_R, width, width - spec.sleeve_hem_taper, spec.sleeve_length, cap)),
            sleeve_place(
                m.shoulder * mirror,
                m.elbow * mirror,
                radius,
                sleeve_top,
                -0.02,
                np.radians(spec.sleeve_lift),
            ),
        ),
    ]
    seams = [
        Seam(FRONT, "side_l", BACK, "side_l"),
        Seam(FRONT, "side_r", BACK, "side_r"),
        Seam(FRONT, "shoulder_l", BACK, "shoulder_l"),
        Seam(FRONT, "shoulder_r", BACK, "shoulder_r"),
        Seam(SLEEVE_L, "under_a", SLEEVE_L, "under_b"),
        Seam(SLEEVE_R, "under_a", SLEEVE_R, "under_b"),
    ]
    for sleeve, side in ((pieces[2], "l"), (pieces[3], "r")):
        # Which half of the cap faces the front depends on the wrap direction.
        mid = sleeve.segment("cap_a").points[len(sleeve.segment("cap_a").points) // 2]
        cap_a_front = sleeve.place(mid[None])[0, 2] > m.shoulder[2]
        front_half, back_half = ("cap_a", "cap_b") if cap_a_front else ("cap_b", "cap_a")
        seams.append(Seam(FRONT, f"arm_{side}", sleeve.name, front_half))
        seams.append(Seam(BACK, f"arm_{side}", sleeve.name, back_half))
    mesh = layout(pieces, seams, spec.spacing, turn_uv=True)
    hems = [(FRONT, "hem"), (BACK, "hem"), (SLEEVE_L, "hem"), (SLEEVE_R, "hem")]
    stiff = np.maximum(
        mesh.band(hems, spec.hem_band), mesh.band([(FRONT, "neck"), (BACK, "neck")], spec.rib)
    )
    # The armpits: between the arm and the torso, where the hanging cloth tears in poses.
    trunk_at = trunk[np.abs(trunk[:, 1] - m.underarm) < SECTION]
    side = float(np.abs(trunk_at[:, 0]).max())
    depth = float(np.median(trunk_at[np.abs(trunk_at[:, 0]) > side - 0.03, 2]))
    # Down the side too: the arm coming down from the A-pose presses its inner skin
    # against the torso there, through cloth standing off the skin.
    pits = tuple(
        (sign * side, m.underarm + rise, depth) for sign in (1.0, -1.0) for rise in (0.02, -0.05)
    )
    mesh = replace(
        mesh, stiff=stiff, hug=pits, arm=arm_share(mesh, spec.arm_band, front.underarm_v)
    )
    return TeeDraft(mesh, m, front, back, sleeve_top, spec.sleeve_length)


def arm_share(mesh: FlatMesh, band: float = ARM_BAND, underarm_v: float | None = None) -> F64:
    """How far each vertex follows its arm: the sleeves in full (the armhole seam too:
    under the arm, cloth that half follows the torso ends up inside the arm when it comes
    down), the torso by the armhole about three quarters (ARM_SEAM_SHARE), less and less
    out to `band` from it. With `underarm_v` (the armhole bottom's flat height) the torso
    below the armhole stays with the torso."""
    share = np.zeros(len(mesh.flat))
    torso = np.isin(mesh.piece, [mesh.names.index(FRONT), mesh.names.index(BACK)])
    for sleeve, sign, armholes in (
        (SLEEVE_L, 1.0, [(FRONT, "arm_l"), (BACK, "arm_l")]),
        (SLEEVE_R, -1.0, [(FRONT, "arm_r"), (BACK, "arm_r")]),
    ):
        share[mesh.piece == mesh.names.index(sleeve)] = sign
        t = np.clip(1.0 - mesh.distance(armholes) / band, 0.0, ARM_SEAM_SHARE)
        on = torso & (t > 0)
        share[on] = sign * t[on] * t[on] * (3.0 - 2.0 * t[on])
    if underarm_v is not None:
        # Not below the armhole: the side seams stay with the torso, or the arm coming down
        # drags them into it.
        for piece in (FRONT, BACK):
            on = mesh.piece == mesh.names.index(piece)
            v = mesh.flat[on, 1] - mesh.flat[on, 1].min()
            t = np.clip((v - underarm_v) / UNDERARM_FADE, 0.0, 1.0)
            share[on] *= t * t * (3.0 - 2.0 * t)
    return share


def tee_lines(draft: TeeDraft, spec: TeeSpec) -> GarmentLines:
    """Seams, finished edges, the neckband join and the coverstitched hems, in UV space."""
    mesh = draft.mesh
    uv = mesh.uvs
    mm = 0.001 / mesh.uv_metres

    def run(piece: str, segment: str) -> F64:
        return uv[mesh.segments[(piece, segment)]]

    seams, edges, stitches = [], [], []
    for key, vertices in mesh.segments.items():
        (seams if mesh.sewn(*key) else edges).append(uv[vertices])
    ribs = []
    for piece in (FRONT, BACK):
        neck = run(piece, "neck")
        seams.append(_inset(neck, spec.rib * 1000 * mm))  # neckband join
        stitches.append(_inset(neck, (spec.rib * 1000 + 2.5) * mm))
        # 1x1 rib wales across the band, one every RIB_PITCH.
        length = float(np.linalg.norm(np.diff(neck, axis=0), axis=1).sum())
        wales = resample(neck, max(2, round(length / (RIB_PITCH * mm))))
        inner = _inset(wales, spec.rib * 1000 * mm)
        ribs += [np.stack([a, b]) for a, b in zip(wales, inner, strict=True)]
        hem = run(piece, "hem")
        stitches.append(_inset(hem, spec.hem_band * 1000 * mm))
        stitches.append(_inset(hem, (spec.hem_band * 1000 - 6.0) * mm))
    for piece in (SLEEVE_L, SLEEVE_R):
        hem = run(piece, "hem")
        stitches.append(_inset(hem, spec.hem_band * 1000 * mm))
        stitches.append(_inset(hem, (spec.hem_band * 1000 - 6.0) * mm))
    return GarmentLines(
        seams=seams,
        edges=edges,
        stitches=stitches,
        ribs=ribs,
        stitch_strength=0.5,
        seam_shadow=0.15,
    )


def _inset(line: F64, distance: float) -> F64:
    """A UV line moved into its piece (outlines are counter-clockwise in flat v up; UV v
    runs the same way)."""
    return offset_line(resample(line, max(len(line), 2)), distance)
