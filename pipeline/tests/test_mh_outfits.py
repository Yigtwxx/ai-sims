"""Outfit garments: body correspondence, cap removal, transfer, body_hide and materials."""

import base64
import dataclasses
import io
import json
import struct
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from asset_pipeline.mh import outfits
from asset_pipeline.mh.compat import curated_compat
from asset_pipeline.mh.geometry import vertex_normals
from asset_pipeline.mh.glb import read_glb
from asset_pipeline.mh.outfits import (
    BodyFit,
    Fit,
    FittedPart,
    Garment,
    GarmentPart,
    OutfitError,
    RayCaster,
    Skeleton,
    body_hide,
    build_transfer,
    encode_bitset,
    fabric_slots,
    find_caps,
    fit_garment,
    hex_from_linear,
    manifest_entries,
    match_by_uv,
    material_key,
    open_edge_vertices,
    outfit_category,
    outfit_label,
    parse_color,
)

# ---------------------------------------------------------------------------- shapes


def _tube(
    radius: float, y0: float, y1: float, rings: int = 24, segments: int = 32
) -> tuple[np.ndarray, np.ndarray]:
    """An open cylinder around the y axis, outward-facing triangles."""
    angles = np.linspace(0, 2 * np.pi, segments, endpoint=False)
    heights = np.linspace(y0, y1, rings)
    vertices = np.array(
        [[radius * np.cos(a), y, radius * np.sin(a)] for y in heights for a in angles]
    )
    triangles = []
    for r in range(rings - 1):
        for s in range(segments):
            a = r * segments + s
            b = r * segments + (s + 1) % segments
            c = (r + 1) * segments + s
            d = (r + 1) * segments + (s + 1) % segments
            triangles += [(a, c, b), (b, c, d)]
    return vertices, np.array(triangles, dtype=np.int64)


def _cap(vertices: np.ndarray, ring: np.ndarray, hub: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Close the loop `ring` (vertex indices in order) with a fan around a new hub vertex."""
    index = len(vertices)
    fan = [(ring[k], ring[(k + 1) % len(ring)], index) for k in range(len(ring))]
    return np.vstack([vertices, hub]), np.array(fan, dtype=np.int64)


def _body(positions: np.ndarray, triangles: np.ndarray, base: np.ndarray | None = None) -> BodyFit:
    """A synthetic BodyFit: one joint, no morphs unless set by the caller."""
    base = positions.copy() if base is None else base
    skeleton = Skeleton(
        names=("root",),
        parents=np.array([-1]),
        translations=np.zeros((1, 3)),
        rotations=np.array([[0.0, 0.0, 0.0, 1.0]]),
        scales=np.ones((1, 3)),
        inverse_binds=np.eye(4)[None],
    )
    return BodyFit(
        gender="female",
        positions=positions,
        normals=vertex_normals(positions, triangles),
        triangles=triangles,
        base_positions=base,
        joints=np.zeros((len(positions), 4), dtype=np.int64),
        weights=np.tile([1.0, 0.0, 0.0, 0.0], (len(positions), 1)),
        morphs={},
        skeleton=skeleton,
        boundary=open_edge_vertices(positions, triangles),
        match_error=0.0,
    )


# ---------------------------------------------------------------------------- correspondence


def test_match_by_uv_recovers_the_permutation() -> None:
    rng = np.random.default_rng(1)
    uvs = rng.random((500, 2))
    order = rng.permutation(500)
    found, error = match_by_uv(uvs, uvs[order] + 1e-7)
    np.testing.assert_array_equal(found, order)
    assert error < 1e-6
    with pytest.raises(OutfitError):
        match_by_uv(uvs, uvs[order] + 0.01)
    with pytest.raises(OutfitError):
        match_by_uv(uvs, np.vstack([uvs[:-1], uvs[:1]]))


def test_open_edges_ignore_split_seam_vertices() -> None:
    vertices, triangles = _tube(0.1, 0.0, 1.0, rings=4, segments=8)
    # Split the first column of vertices (a UV seam): same positions, new indices.
    split = vertices[::8].copy()
    vertices2 = np.vstack([vertices, split])
    triangles2 = triangles.copy()
    seam = {r * 8: len(vertices) + r for r in range(4)}
    for t in range(0, len(triangles2), 4):
        triangles2[t] = [seam.get(v, v) for v in triangles2[t]]
    edges = open_edge_vertices(vertices2, triangles2)
    rims = np.isclose(vertices2[:, 1], 0.0) | np.isclose(vertices2[:, 1], 1.0)
    np.testing.assert_array_equal(edges, rims)


# ---------------------------------------------------------------------------- caps


def test_caps_are_fans_the_body_runs_through() -> None:
    sleeve, sleeve_triangles = _tube(0.06, 0.0, 0.3)
    ring = np.arange(32)  # bottom rim, in order around the axis
    vertices, cap = _cap(sleeve, ring, np.array([[0.0, 0.0, 0.0]]))
    # A flat 16-fan patch lying on the sleeve's outside (pocket-corner-like).
    angles = np.linspace(0, 2 * np.pi, 16, endpoint=False)
    patch_ring = np.array([[0.07, 0.15 + 0.02 * np.sin(a), 0.02 * np.cos(a)] for a in angles])
    patch_start = len(vertices)
    vertices = np.vstack([vertices, patch_ring, [[0.07, 0.15, 0.0]]])
    patch = np.array(
        [(patch_start + k, patch_start + (k + 1) % 16, patch_start + 16) for k in range(16)],
        dtype=np.int64,
    )
    # The patch's rim is shared with a skirt of triangles around it, like a sewn-on piece.
    skirt_start = len(vertices)
    outer = np.array([[0.07, 0.15 + 0.04 * np.sin(a), 0.04 * np.cos(a)] for a in angles])
    vertices = np.vstack([vertices, outer])
    skirt = []
    for k in range(16):
        a, b = patch_start + k, patch_start + (k + 1) % 16
        c, d = skirt_start + k, skirt_start + (k + 1) % 16
        skirt += [(a, c, b), (b, c, d)]
    triangles = np.vstack([sleeve_triangles, cap, patch, np.array(skirt)])
    arm, arm_triangles = _tube(0.04, -0.2, 0.5)
    drop, fans = find_caps(vertices, triangles, _body(arm, arm_triangles))
    assert fans == 1
    assert drop[len(sleeve_triangles) : len(sleeve_triangles) + 32].all()
    assert not drop[: len(sleeve_triangles)].any() and not drop[-(16 + 32) :].any()
    # Without a body both fans pass the geometric test.
    _, geometric = find_caps(vertices, triangles)
    assert geometric == 2


def test_zero_normals_take_the_geometric_normal() -> None:
    vertices = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, -1.0]])
    triangles = np.array([[0, 1, 2]])
    normals = np.array([[0.0, 1.0, 0.0], [0.0, 0.0, 0.0], [0.0, 2.0, 0.0]])
    repaired = outfits._repair_normals(normals, vertices, triangles)
    np.testing.assert_allclose(repaired, np.tile([0.0, 1.0, 0.0], (3, 1)), atol=1e-12)


# ---------------------------------------------------------------------------- transfer


def test_transfer_rows_sum_to_one_and_follow_the_skin() -> None:
    base, triangles = _tube(0.1, 0.0, 1.0)
    web = base * np.array([1.0, 0.95, 1.0])  # the web body is shorter
    body = _body(web, triangles, base)
    angles = np.linspace(0, 2 * np.pi, 7, endpoint=False)
    near = np.array([[0.102 * np.cos(a), 0.5, 0.102 * np.sin(a)] for a in angles])
    far = np.array([[0.2 * np.cos(a), 0.5, 0.2 * np.sin(a)] for a in angles])
    transfer = build_transfer(np.vstack([near, far]), body)
    np.testing.assert_allclose(np.asarray(transfer.matrix.sum(axis=1)).ravel(), 1.0)
    moved = transfer.matrix @ body.displacement
    # Close to the skin the displacement is the skin's own (-2.5 cm at mid height).
    np.testing.assert_allclose(moved[:7, 1], -0.025, atol=1e-3)
    assert np.all(transfer.signed[:7] > 0) and np.all(transfer.distance[7:] > 0.09)


LEG_X = 0.08  # metres from the middle to each leg's axis
SHEET_SPACING = 0.005


def _two_legs() -> BodyFit:
    """Two 6 cm legs (joints 1 and 2) whose `body_hips_max` moves them 1 cm apart."""
    leg, leg_triangles = _tube(0.06, 0.0, 0.8, rings=81, segments=64)
    offset = np.array([LEG_X, 0.0, 0.0])
    left, right = leg + offset, leg - offset
    positions = np.vstack([left, right])
    triangles = np.vstack([leg_triangles, leg_triangles + len(leg)])
    body = _body(positions, triangles)
    skeleton = dataclasses.replace(
        body.skeleton,
        names=("root", "thigh_l", "thigh_r"),
        parents=np.array([-1, 0, 0]),
        translations=np.zeros((3, 3)),
        rotations=np.tile([0.0, 0.0, 0.0, 1.0], (3, 1)),
        scales=np.ones((3, 3)),
        inverse_binds=np.tile(np.eye(4), (3, 1, 1)),
    )
    joints = np.zeros((len(positions), 4), dtype=np.int64)
    joints[: len(leg), 0], joints[len(leg) :, 0] = 1, 2
    apart = np.zeros_like(positions)
    apart[:, 0] = np.sign(positions[:, 0]) * 0.01
    return dataclasses.replace(
        body, joints=joints, skeleton=skeleton, morphs={"body_hips_max": apart}
    )


def _front_panel(z: float) -> GarmentPart:
    """A flat panel at depth z in front of both legs, 5 mm grid, facing forward (+z)."""
    xs = np.arange(-0.12, 0.12 + 1e-9, SHEET_SPACING)
    ys = np.arange(0.3, 0.5 + 1e-9, 0.01)
    vertices = np.array([[x, y, z] for y in ys for x in xs])
    columns = len(xs)
    triangles = []
    for r in range(len(ys) - 1):
        for c in range(columns - 1):
            a, b = r * columns + c, r * columns + c + 1
            triangles += [(a, b, a + columns), (b, b + columns, a + columns)]
    triangles = np.array(triangles, dtype=np.int64)
    return GarmentPart(
        material="MI_test",
        positions=vertices,
        normals=vertex_normals(vertices, triangles),
        uvs=np.zeros((len(vertices), 2)),
        triangles=triangles,
    )


def test_cloth_spanning_two_legs_moves_like_a_sheet_over_both() -> None:
    body = _two_legs()
    panel = _front_panel(0.10)  # 4 cm in front of the legs, 6.8 cm off the skin mid-way
    fit = fit_garment(Garment(parts=[panel]), body)
    part = fit.parts[0]
    x = panel.positions[:, 0]
    moved = part.morphs["body_hips_max"][:, 0]
    middle = np.isclose(x, 0.0)
    assert np.abs(moved[middle]).max() < 1e-3, "the middle should stay between the legs"
    over_legs = np.isclose(np.abs(x), LEG_X)
    np.testing.assert_allclose(moved[over_legs], np.sign(x[over_legs]) * 0.01, atol=1e-3)
    # Neighbours are 5 mm apart. The near kernel took one leg on each side of the middle:
    # the panel split there by the full 2 cm (10 mm between neighbours). As a sheet it
    # stretches evenly over the span between the legs.
    rows = moved.reshape(-1, len(np.unique(x)))
    step = np.abs(np.diff(rows, axis=1)).max()
    assert step < 0.3 * SHEET_SPACING, f"panel tears: neighbours differ by {step * 1e3:.1f} mm"
    # Skin weights: the middle hangs from both thighs alike.
    for joints, weights in zip(part.joints[middle], part.weights[middle], strict=True):
        share = {int(j): float(w) for j, w in zip(joints, weights, strict=True) if w > 0}
        assert share.get(1, 0.0) > 0.4 and share.get(2, 0.0) > 0.4, share
    assert fit.stats["bridged"]["full"] > 0


def test_cloth_over_one_leg_or_on_the_skin_keeps_its_rows(monkeypatch) -> None:
    legs = _two_legs()
    angles = np.linspace(-np.pi / 3, np.pi / 3, 9)  # the outer side of the +x leg
    loose = np.array(
        [[LEG_X + 0.09 * np.cos(a), y, 0.09 * np.sin(a)] for y in (0.3, 0.5) for a in angles]
    )
    near = np.array([[LEG_X - 0.0605, y, 0.0] for y in (0.3, 0.4, 0.5)])  # in the gap
    points = np.vstack([loose, near])
    transfer = build_transfer(points, legs)
    assert not transfer.bridge.any(), "cloth over one leg or on the skin bridged"
    monkeypatch.setattr(outfits, "BRIDGE_SHARE", np.inf)  # bridging off: the near kernel
    reference = build_transfer(points, legs)
    np.testing.assert_allclose(transfer.matrix.toarray(), reference.matrix.toarray(), atol=1e-15)


def test_body_limbs_are_the_legs_side_by_side() -> None:
    legs = _two_legs()
    half = len(legs.positions) // 2
    np.testing.assert_allclose(legs.limbs[:half], [[1.0, 0.0]] * half)
    np.testing.assert_allclose(legs.limbs[half:], [[0.0, 1.0]] * half)
    # An arm hangs from its own clavicle: it is no side-by-side limb.
    names = ("pelvis", "spine_01", "clavicle_l", "upperarm_l", "clavicle_r", "upperarm_r")
    skeleton = dataclasses.replace(
        legs.skeleton, names=names, parents=np.array([-1, 0, 1, 2, 1, 4])
    )
    joints = np.zeros_like(legs.joints)
    joints[:half, 0], joints[half:, 0] = 3, 5
    arms = dataclasses.replace(legs, skeleton=skeleton, joints=joints)
    assert arms.limbs.shape == (len(legs.positions), 0)


def test_fit_moves_scales_and_clears_the_skin() -> None:
    base, triangles = _tube(0.1, 0.0, 1.0)
    web = base * np.array([1.05, 1.0, 1.05])  # wider: the sleeve would sink into it
    body = _body(web, triangles, base)
    sleeve, sleeve_triangles = _tube(0.102, 0.3, 0.7, rings=10, segments=24)
    part = GarmentPart(
        material="MI_test",
        positions=sleeve,
        normals=vertex_normals(sleeve, sleeve_triangles),
        uvs=np.zeros((len(sleeve), 2)),
        triangles=sleeve_triangles,
    )
    fit = fit_garment(Garment(parts=[part]), body)
    radius = np.linalg.norm(fit.parts[0].positions[:, [0, 2]], axis=1)
    assert np.all(radius >= 0.105 + outfits.CLEARANCE - 1e-3)
    assert fit.stats["pushed_out"] == 0 or radius.min() > 0.105
    np.testing.assert_allclose(fit.parts[0].weights[:, 0], 1.0)


def test_fit_keeps_the_garment_outside_the_skin_at_a_slider_end() -> None:
    limb, triangles = _tube(0.1, 0.0, 1.0)
    body = _body(limb, triangles)
    # The skin grows 1 cm at the morph's end; a sleeve 5 mm out would end inside it if
    # its own morph moved it less (here: not at all).
    grow = limb * np.array([0.1, 0.0, 0.1])
    body.morphs["body_weight_max"] = grow
    sleeve, _ = _tube(0.105, 0.3, 0.7, rings=10, segments=24)
    morphs = {"body_weight_max": np.zeros_like(sleeve)}
    cleared, counts = outfits.clear_morphs(
        sleeve, morphs, body, outside=np.ones(len(sleeve), dtype=bool)
    )
    end = sleeve + cleared["body_weight_max"]
    radius = np.linalg.norm(end[:, [0, 2]], axis=1)
    assert np.all(radius >= 0.11 + outfits.CLEARANCE - 1e-3), "pushed out of the grown skin"
    assert counts["body_weight_max"] == len(sleeve)
    # A morph that keeps the clearance is left alone.
    morphs = {"body_weight_max": sleeve * np.array([0.1, 0.0, 0.1])}
    cleared, counts = outfits.clear_morphs(
        sleeve, morphs, body, outside=np.ones(len(sleeve), dtype=bool)
    )
    np.testing.assert_allclose(cleared["body_weight_max"], morphs["body_weight_max"])
    assert counts["body_weight_max"] == 0


def _two_layer_sleeve(outer: float, inner: float) -> GarmentPart:
    """A sleeve with thickness: an outward-facing outer tube and an inward-facing inner tube
    (same rings and angles, so vertex k of one lies over vertex k of the other)."""
    out_v, out_t = _tube(outer, 0.3, 0.7, rings=10, segments=24)
    in_v, in_t = _tube(inner, 0.3, 0.7, rings=10, segments=24)
    vertices = np.vstack([out_v, in_v])
    triangles = np.vstack([out_t, in_t[:, ::-1] + len(out_v)])
    return GarmentPart(
        material="MI_test",
        positions=vertices,
        normals=vertex_normals(vertices, triangles),
        uvs=np.zeros((len(vertices), 2)),
        triangles=triangles,
    )


def test_fit_push_keeps_the_inner_layer_under_the_outer() -> None:
    limb, triangles = _tube(0.1, 0.0, 1.0)
    body = _body(limb, triangles)
    # Both layers are closer than the clearance: pushing each to it would flatten them
    # onto one surface and the inner side (two-sided cloth) would show through the outer.
    part = _two_layer_sleeve(0.1015, 0.1005)
    half = len(part.positions) // 2
    fit = fit_garment(Garment(parts=[part]), body)
    radius = np.linalg.norm(fit.parts[0].positions[:, [0, 2]], axis=1)
    gap = radius[:half] - radius[half:]
    assert gap.min() > 0.0009, f"layers collapsed: smallest gap {gap.min() * 1e3:.2f} mm"
    assert radius[half:].min() >= 0.1 + outfits.CLEARANCE - 1e-3, "inner layer still in skin"


def test_morph_clearance_keeps_the_inner_layer_under_the_outer() -> None:
    limb, triangles = _tube(0.1, 0.0, 1.0)
    body = _body(limb, triangles)
    body.morphs["body_weight_max"] = limb * np.array([0.1, 0.0, 0.1])  # skin grows 1 cm
    part = _two_layer_sleeve(0.1063, 0.105)
    half = len(part.positions) // 2
    morphs = {"body_weight_max": np.zeros_like(part.positions)}
    cleared, _ = outfits.clear_morphs(
        part.positions, morphs, body, outside=np.ones(len(part.positions), dtype=bool)
    )
    end = part.positions + cleared["body_weight_max"]
    radius = np.linalg.norm(end[:, [0, 2]], axis=1)
    gap = radius[:half] - radius[half:]
    assert gap.min() > 0.0009, f"layers collapsed: smallest gap {gap.min() * 1e3:.2f} mm"
    assert radius[half:].min() >= 0.11 + outfits.CLEARANCE - 1e-3, "inner layer in grown skin"


def _chest(spacing: float = 0.005) -> BodyFit:
    """A front-facing (+z) chest: a flat skin with two bumps 12 cm apart at y 0.2."""
    xs = np.arange(-0.15, 0.15 + 1e-9, spacing)
    ys = np.arange(0.0, 0.3 + 1e-9, spacing)
    grid = np.array([[x, y, 0.0] for y in ys for x in xs])
    for centre in (-0.06, 0.06):
        squared = (grid[:, 0] - centre) ** 2 + (grid[:, 1] - 0.2) ** 2
        grid[:, 2] += 0.04 * np.exp(-squared / (2 * 0.02**2))
    columns = len(xs)
    triangles = []
    for r in range(len(ys) - 1):
        for c in range(columns - 1):
            a, b = r * columns + c, r * columns + c + 1
            triangles += [(a, b, a + columns), (b, b + columns, a + columns)]
    return _body(grid, np.array(triangles, dtype=np.int64))


def _sheet(z: float) -> np.ndarray:
    """Cloth points on the plane at depth z over the chest, 1 cm apart."""
    return np.array(
        [[x, y, z] for y in np.arange(0.05, 0.28, 0.01) for x in np.arange(-0.1, 0.101, 0.01)]
    )


def test_front_hull_bridges_a_hollow_sideways_only() -> None:
    skin = np.array([[-0.1, 0.0, 0.0], [-0.05, 0.0, 0.04], [0.0, 0.0, 0.0], [0.05, 0.0, 0.04]])
    points = np.array([[0.0, 0.0, 0.1], [-0.075, 0.0, 0.1], [0.08, 0.0, 0.1], [0.0, 0.5, 0.1]])
    depth, inside = outfits.front_hull(points, skin)
    assert inside.tolist() == [True, True, False, False], f"rows found: {inside}"
    assert depth[0] == pytest.approx(0.04), f"valley bridged at {depth[0]}, expected 0.04"
    assert depth[1] == pytest.approx(0.02), f"slope read at {depth[1]}, expected 0.02"


def test_hug_torso_spans_the_cleavage_and_follows_the_underside() -> None:
    body = _chest()
    cloth = _sheet(0.045)  # a curtain 5 mm over the bump tops
    hugged, _ = outfits.hug_torso(cloth, body, 0.85)
    at = {tuple(np.round(c[:2], 2)): h[2] for c, h in zip(cloth, hugged, strict=True)}
    cleavage = at[(0.0, 0.2)]
    under = at[(0.06, 0.08)]
    assert cleavage > 0.035, f"cloth sank into the cleavage: z {cleavage * 1e3:.1f} mm"
    assert under < 0.012, f"curtain left under the bump: z {under * 1e3:.1f} mm"


def test_hug_torso_leaves_a_zero_strength_garment_alone() -> None:
    body = _chest()
    cloth = _sheet(0.045)
    hugged, pull = outfits.hug_torso(cloth, body, 0.0)
    assert np.array_equal(hugged, cloth) and not pull.any(), "zero strength moved cloth"


def test_hug_torso_keeps_the_gap_between_layers() -> None:
    torso, triangles = _tube(0.1, 0.0, 1.0)
    body = _body(torso, triangles)
    part = _two_layer_sleeve(0.13, 0.128)
    half = len(part.positions) // 2
    hugged, pull = outfits.hug_torso(part.positions, body, 0.85)
    radius = np.linalg.norm(hugged[:, [0, 2]], axis=1)
    apart = np.linalg.norm(hugged[:half] - hugged[half:], axis=1)
    assert pull.max() > 0.01, f"nothing hugged: largest pull {pull.max() * 1e3:.1f} mm"
    assert apart.min() > 0.0019, f"layers squeezed: closest pair {apart.min() * 1e3:.2f} mm"
    assert np.all(radius[:half] > radius[half:]), "inner layer came out over the outer"


def test_hug_applies_to_listed_female_outfits_only() -> None:
    assert outfits.hug_for("OA_TCrop3QSlv", "female") > 0.0, "crop top not hugged"
    assert outfits.hug_for("OA_TCrop3QSlv", "male") == 0.0, "male garment hugged"
    assert outfits.hug_for("OA_Hoodie", "female") == 0.0, "loose top hugged"


def test_closed_shoes_hide_every_toe_and_sandals_none() -> None:
    limb, triangles = _tube(0.05, 0.0, 1.0, rings=11, segments=8)
    body = _body(limb, triangles)
    # Two joints: the lower half of the tube is a toe, the upper half the foot.
    body = dataclasses.replace(
        body,
        skeleton=Skeleton(
            names=("foot_l", "ball_l"),
            parents=np.array([-1, 0]),
            translations=np.zeros((2, 3)),
            rotations=np.tile([0.0, 0.0, 0.0, 1.0], (2, 1)),
            scales=np.ones((2, 3)),
            inverse_binds=np.tile(np.eye(4), (2, 1, 1)),
        ),
    )
    toes = limb[:, 1] < 0.5
    body.joints[toes, 0] = 1
    closed = toes & (limb[:, 1] > 0.15)  # the cap hides all but the tips
    hidden, grew = outfits.hide_closed_toes(closed, body)
    assert grew and hidden[toes].all()
    sandal = toes & (limb[:, 1] > 0.4)
    hidden, grew = outfits.hide_closed_toes(sandal, body)
    assert not grew
    np.testing.assert_array_equal(hidden, sandal)


# ---------------------------------------------------------------------------- body_hide


def test_ray_caster_hits_triangles_within_range() -> None:
    vertices = np.array([[-1.0, -1.0, 0.5], [1.0, -1.0, 0.5], [0.0, 1.0, 0.5]])
    caster = RayCaster(vertices, np.array([[0, 1, 2]]))
    origins = np.zeros((3, 3))
    directions = np.array([[0.0, 0.0, 1.0], [0.0, 0.0, -1.0], [0.0, 0.0, 1.0]])
    hit = caster.blocked(origins, directions, np.array([1.0, 1.0, 0.4]))
    np.testing.assert_array_equal(hit, [True, False, False])


def test_body_hide_covers_the_middle_and_spares_the_openings() -> None:
    limb, limb_triangles = _tube(0.05, 0.0, 1.0, rings=41, segments=32)
    body = _body(limb, limb_triangles)
    sleeve, sleeve_triangles = _tube(0.06, 0.3, 0.7, rings=17, segments=32)
    part = FittedPart(
        material="m",
        positions=sleeve,
        normals=vertex_normals(sleeve, sleeve_triangles),
        uvs=np.zeros((len(sleeve), 2)),
        triangles=sleeve_triangles,
        joints=np.zeros((len(sleeve), 4), dtype=np.int64),
        weights=np.tile([1.0, 0, 0, 0], (len(sleeve), 1)),
        morphs={},
    )
    hidden, stats = body_hide(Fit(parts=[part], stats={}), body)
    y = limb[:, 1]
    assert hidden[(y > 0.45) & (y < 0.55)].all(), "skin deep inside the sleeve hides"
    assert not hidden[(y < 0.3) | (y > 0.7)].any(), "skin outside the sleeve stays"
    assert not hidden[(y > 0.3) & (y < 0.32)].any(), "a margin stays visible at the cuff"
    assert stats["opening_vertices"] > 0


def test_bitset_is_lsb_first_base64() -> None:
    mask = np.zeros(10, dtype=bool)
    mask[[0, 9]] = True
    data = base64.b64decode(encode_bitset(mask))
    assert data == bytes([0b00000001, 0b00000010])


# ---------------------------------------------------------------------------- metadata


def test_categories_follow_coverage() -> None:
    assert outfit_category("OA_Boots", {"feet": 0.9, "calves": 0.3}) == "shoes"
    assert outfit_category("OA_Jeans", {"thighs": 0.8, "hips": 0.7, "calves": 0.8}) == "bottom"
    assert outfit_category("OA_Tee", {"torso": 0.9, "upperArms": 0.5}) == "top"
    assert outfit_category("OA_Suit", {"torso": 0.9, "thighs": 0.8}) == "full"
    assert outfit_category("DefaultGarment", {"torso": 0.9}) == "full"


def test_material_keys_are_short_and_gender_independent() -> None:
    assert (
        material_key("MI_WI_OA_techwearOutfit_M_techwear_bodyShapeH_MH_Jacket", "OA_techwearOutfit")
        == "techwear_MH_Jacket"
    )
    assert material_key("MI_WI_OA_Boots_M_shs_boots", "OA_Boots") == "shs_boots"
    assert material_key("MI_Shirt_01", "OA_Shirt_01") == "Shirt_01"


def test_fabric_slots_follow_the_static_switches() -> None:
    material = {
        "static_switches": {
            "DoDetailColor": False,
            "DoSculptDetail": True,
            "DoMacroVariation": True,
            "DoDetailNormal": True,
            "MaterialB option": False,
            "DoWrinkles": True,
            "DoPill": False,
        },
        "scalars": {"detailColor_txOverlay": 1.0, "detailColor_txMult": 0.0},
    }
    slots = fabric_slots(material)
    assert {"normalmap", "AO", "Masks", "CustomStitch"} <= set(slots)
    assert "MacroTex_Variation" in slots and "Wrinkle_normal" in slots
    assert "DetailTex_Color" not in slots, "overlay 1 and mult 0 never sample it"
    assert "DetailTex_Variation" not in slots, "sculpt detail reads Masks.A instead"
    assert not any(slot.startswith("B_") for slot in slots)
    assert "Pill_n_map" not in slots
    assert slots["detailTex_normal"] == ("normal", True)


def test_colour_parameters_follow_the_masks_that_show_them() -> None:
    switches = {"MaterialB option": True, "DoMaterialC": True}
    textures = {
        "Masks": {"file": "m.ktx2", "coverage": [0.5, 0.0, 0.3, 1.0]},
        "AO": {"file": "ao.ktx2", "coverage": [1.0, 1.0, 0.0, 0.0]},
        "CustomStitch": {"constant": [0.0, 0.0, 0.0, 0.0]},
    }
    shown = outfits.visible_colors(switches, textures)
    assert shown == {"diffuse_color_1", "B_diffuse_color_1"}, "no G, no stitches, no C mask"
    textures["CustomStitch"] = {"file": "s.ktx2", "coverage": [0.0007]}
    assert "diffuse_color_2" in outfits.visible_colors(switches, textures), "thin stitches count"
    textures["AO"] = {"file": "ao.ktx2", "coverage": [1.0, 1.0, 0.0]}  # RGB map: alpha is 1
    assert "C_color" in outfits.visible_colors(switches, textures)
    shown = outfits.visible_colors({**switches, "B_UseAColor": True}, textures)
    assert "B_diffuse_color_1" not in shown, "region B reuses colour 1 or 2"


def test_colors_parse_from_unreal_and_print_as_srgb() -> None:
    assert parse_color("(R=0.5,G=0.25,B=1.000000,A=1.0)") == [0.5, 0.25, 1.0, 1.0]
    assert parse_color("nope") is None
    assert hex_from_linear([0.0, 1.0, 0.2158605]) == "#00ff80"


def test_template_blue_second_colour_takes_colour_one() -> None:
    blue = [0.0382, 0.2582, 1.0, 1.0]
    assert hex_from_linear(blue) == outfits.TEMPLATE_BLUE
    vectors = {"diffuse_color_1": [0.2, 0.1, 0.05, 1.0], "diffuse_color_2": blue}
    assert outfits.replace_template_colors(vectors) == ["diffuse_color_2"]
    assert vectors["diffuse_color_2"] == [0.2, 0.1, 0.05, 1.0]


def test_chosen_second_colour_is_kept() -> None:
    vectors = {"diffuse_color_1": [0.2, 0.1, 0.05, 1.0], "diffuse_color_2": [0.5, 0.5, 0.5, 1.0]}
    assert outfits.replace_template_colors(vectors) == []
    assert vectors["diffuse_color_2"] == [0.5, 0.5, 0.5, 1.0]


def test_labels_come_from_the_table_or_the_name() -> None:
    assert outfit_label("OA_Jeans")["en"] == "Jeans"
    assert outfit_label("OA_NewThing")["en"] == "New Thing"


def test_manifest_entries_merge_genders(tmp_path: Path) -> None:
    def record(gender: str, regions: list[str]) -> dict:
        return {
            "id": "outfit.OA_Jeans",
            "name": "OA_Jeans",
            "gender": gender,
            "category": "bottom",
            "label": {"tr": "Kot", "en": "Jeans"},
            "file": f"outfits/OA_Jeans/{gender}.glb",
            "params": [{"name": "diffuse_color_1", "type": "color", "default": "#101010"}],
            "tintPresets": [],
            "hidesBodyRegions": regions,
        }

    (tmp_path / "outfits" / "OA_Jeans").mkdir(parents=True)
    (tmp_path / "outfits" / "OA_Jeans" / "thumbnail.webp").write_bytes(b"x")
    entries = manifest_entries(
        [record("male", ["thighs", "calves"]), record("female", ["thighs", "hips"])], tmp_path
    )
    assert len(entries) == 1
    entry = entries[0]
    assert entry["compat"] == "unisex"
    assert entry["files"] == {
        "female": "outfits/OA_Jeans/female.glb",
        "male": "outfits/OA_Jeans/male.glb",
    }
    assert entry["hidesBodyRegions"] == ["thighs"]
    assert entry["thumbnail"] == "outfits/OA_Jeans/thumbnail.webp"


def _yoga_record(gender: str) -> dict:
    return {
        "id": "outfit.OA_Yogaful",
        "name": "OA_Yogaful",
        "gender": gender,
        "category": "bottom",
        "label": {"tr": "Tayt", "en": "Yoga pants"},
        "file": f"outfits/OA_Yogaful/{gender}.glb",
        "params": [
            {"name": name, "type": "color", "default": "#444444"}
            for name in ("diffuse_color_1", "diffuse_color_2")
        ],
        "tintPresets": [],
        "hidesBodyRegions": [],
    }


def test_manifest_entries_offer_a_curated_item_to_its_gender_only(tmp_path: Path) -> None:
    entries = manifest_entries([_yoga_record("female"), _yoga_record("male")], tmp_path)
    assert entries[0]["compat"] == "female", entries[0]["compat"]


def test_manifest_entries_reject_a_curated_gender_without_its_mesh(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="OA_Yogaful is for female"):
        manifest_entries([_yoga_record("male")], tmp_path)


def test_curated_compat_reads_the_list_and_rejects_unknown_genders(tmp_path: Path) -> None:
    listed = tmp_path / "compat.json"
    listed.write_text(
        json.dumps({"grooms": {"Hair_S_Pixie": "female", "Hair_Typo": "woman"}, "outfits": {}}),
        encoding="utf-8",
    )
    assert curated_compat("grooms", "Hair_S_Pixie", listed) == "female"
    assert curated_compat("grooms", "Hair_L_Straight", listed) is None
    with pytest.raises(ValueError, match="Hair_Typo"):
        curated_compat("grooms", "Hair_Typo", listed)


def test_curated_tints_label_presets_and_reject_unknown_params(tmp_path: Path) -> None:
    tints = tmp_path / "tints.json"
    tints.write_text(
        json.dumps(
            {
                "colors": {"navy": {"en": "Navy", "tr": "Lacivert"}},
                "outfits": {
                    "OA_Tee": [{"id": "navy", "values": {"diffuse_color_1": "#1f2941"}}],
                    "OA_Typo": [{"id": "navy", "values": {"diffuse_colour_1": "#1f2941"}}],
                },
            }
        ),
        encoding="utf-8",
    )
    params = [{"name": "diffuse_color_1", "type": "color", "default": "#444444"}]
    assert outfits.curated_tints("OA_Tee", params, tints) == [
        {
            "id": "navy",
            "label": {"tr": "Lacivert", "en": "Navy"},
            "values": {"diffuse_color_1": "#1f2941"},
        }
    ]
    assert outfits.curated_tints("OA_Jeans", params, tints) is None
    with pytest.raises(ValueError, match="diffuse_colour_1"):
        outfits.curated_tints("OA_Typo", params, tints)


# ---------------------------------------------------------------------------- archive


def test_real_outfit_converts(archive: Path, tmp_path: Path, monkeypatch) -> None:
    body_glb = archive / "web" / "bodies" / "female" / "body.glb"
    base = outfits.base_body_path(archive, "female")
    unit_folder = archive / "raw" / "outfits" / "female" / "WI_OA_Flipflops"
    if not (body_glb.is_file() and base.is_file() and (unit_folder / "done.json").is_file()):
        pytest.skip("no converted female body or outfit export in the archive")

    def fake_encode(image: np.ndarray, output: Path, settings: object) -> int:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(b"KTX2")
        return 4

    monkeypatch.setattr(outfits, "encode_ktx2", fake_encode)
    body = BodyFit.load(body_glb, base, "female")
    unit = outfits.OutfitUnit.load(unit_folder, "female")
    result = outfits.convert_outfit(unit, body, tmp_path)
    glb = tmp_path / "outfits" / "OA_Flipflops" / "female.glb"
    assert glb.is_file() and glb in result.outputs
    record = result.record
    assert record["category"] == "shoes" and record["file"] == "outfits/OA_Flipflops/female.glb"
    from asset_pipeline.mh.glb import read_glb

    document, _ = read_glb(glb.read_bytes())
    mh = document["scenes"][0]["extras"]["mh"]
    assert mh["kind"] == "outfit" and mh["gender"] == "female"
    assert len(base64.b64decode(mh["body_hide"])) == (len(body.positions) + 7) // 8
    assert json.dumps(mh["materials"])  # serialisable, keyed by material
    names = {node.get("name") for node in document["nodes"]}
    assert "foot_l" in names and "foot_r" in names


# ---------------------------------------------------------------------------- baked maps


def _png(pixels: np.ndarray) -> bytes:
    buffer = io.BytesIO()
    Image.fromarray(pixels.astype(np.uint8)).save(buffer, format="PNG")
    return buffer.getvalue()


def _baked_unit(folder: Path) -> "outfits.OutfitUnit":
    """A unit on a custom master whose export also baked its maps (8x8 test images)."""
    ramp = np.arange(64, dtype=np.uint8).reshape(8, 8) * 3
    color = np.stack([ramp, ramp // 2, np.full_like(ramp, 40)], axis=-1)
    rough = np.stack([np.zeros_like(ramp), 200 - ramp, np.zeros_like(ramp)], axis=-1)
    normal = np.stack([np.full_like(ramp, 128), ramp // 4 + 100, np.full_like(ramp, 255)], -1)
    occlusion = np.stack([255 - ramp] * 3, axis=-1)
    blobs = [_png(image) for image in (color, rough, normal, occlusion)]
    views, offset, binary = [], 0, b""
    for blob in blobs:
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(blob)})
        padded = blob + b"\0" * (-len(blob) % 4)
        binary += padded
        offset += len(padded)
    document = {
        "asset": {"version": "2.0"},
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": views,
        "images": [
            {"name": f"MI_Custom_{n}", "mimeType": "image/png", "bufferView": i}
            for i, n in enumerate(("BaseColor", "MetallicRoughness", "Normal", "Occlusion"))
        ],
        "textures": [{"source": i} for i in range(4)],
        "materials": [
            {
                "name": "MI_Custom",
                "pbrMetallicRoughness": {
                    "baseColorTexture": {"index": 0},
                    "metallicRoughnessTexture": {"index": 1},
                },
                "normalTexture": {"index": 2},
                "occlusionTexture": {"index": 3},
            }
        ],
    }
    text = json.dumps(document).encode()
    text += b" " * (-len(text) % 4)
    glb = struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(text) + 8 + len(binary))
    glb += struct.pack("<I4s", len(text), b"JSON") + text
    glb += struct.pack("<I4s", len(binary), b"BIN\0") + binary
    folder.mkdir(parents=True)
    (folder / "OutfitBase_female_Outfits.baked.glb").write_bytes(glb)
    info = {
        "materials": {
            "/Game/X/MI_Custom.MI_Custom": {"parents": ["/Game/X/M_Shirt_01.M_Shirt_01"]}
        },
        "meshes": {
            "OutfitBase_female_Outfits": {"baked_glb": "OutfitBase_female_Outfits.baked.glb"}
        },
    }
    (folder / "outfit.json").write_text(json.dumps(info), encoding="utf-8")
    (folder / "done.json").write_text(json.dumps({"files": []}), encoding="utf-8")
    return outfits.OutfitUnit.load(folder, "female")


def test_custom_master_takes_the_maps_unreal_baked(tmp_path: Path, monkeypatch) -> None:
    encoded: dict[str, np.ndarray] = {}

    def fake_encode(image: np.ndarray, output: Path, settings: object) -> int:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(b"KTX2")
        encoded[output.name] = image
        return 4

    monkeypatch.setattr(outfits, "encode_ktx2", fake_encode)
    unit = _baked_unit(tmp_path / "raw" / "WI_OA_Custom")
    maps = outfits.baked_maps(unit, "MI_Custom")
    assert set(maps) == {"color", "normal", "data"}
    orm = maps["data"].pixels
    assert orm is not None
    # Occlusion red into R, roughness and metallic stay in G and B.
    assert orm[0, 1].tolist() == [252, 197, 0]

    writer = outfits.TextureWriter(tmp_path / "web")
    result = outfits.convert_material(unit, "MI_Custom", writer, {})
    assert result.extras["shader"] == "plain"
    assert result.extras["baked"] == "OutfitBase_female_Outfits.baked.glb"
    assert set(result.textures) == {"color", "normal", "orm"}
    assert all(f.startswith("outfits/OA_Custom/") for f in result.textures.values())
    pbr = result.gltf["pbrMetallicRoughness"]
    assert pbr["baseColorFactor"] == [1.0, 1.0, 1.0, 1.0] and pbr["metallicFactor"] == 1.0
    assert result.gltf["normalTexture"] == {"scale": 1.0}
    assert outfits.baked_maps(unit, "MI_Other") == {}


def test_custom_master_keeps_the_factors_unreal_baked_to_constants(
    tmp_path: Path, monkeypatch
) -> None:
    """Unreal leaves out metallicRoughnessTexture when metallic and roughness bake to
    constants and writes them as factors: those factors, and the occlusion map, must stay."""

    def fake_encode(image: np.ndarray, output: Path, settings: object) -> int:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(b"KTX2")
        return 4

    monkeypatch.setattr(outfits, "encode_ktx2", fake_encode)
    unit = _baked_unit(tmp_path / "raw" / "WI_OA_Custom")
    path = unit.folder / "OutfitBase_female_Outfits.baked.glb"
    document, binary = read_glb(path.read_bytes())
    pbr = document["materials"][0]["pbrMetallicRoughness"]
    del pbr["metallicRoughnessTexture"]
    pbr.update(metallicFactor=0.0, roughnessFactor=0.5, baseColorFactor=[0.5, 1.0, 1.0, 1.0])
    text = json.dumps(document).encode()
    text += b" " * (-len(text) % 4)
    glb = struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(text) + 8 + len(binary))
    glb += struct.pack("<I4s", len(text), b"JSON") + text
    glb += struct.pack("<I4s", len(binary), b"BIN\0") + binary
    path.write_bytes(glb)

    assert outfits.baked_factors(unit, "MI_Custom") == {
        "baseColorFactor": [0.5, 1.0, 1.0, 1.0],
        "metallicFactor": 0.0,
        "roughnessFactor": 0.5,
    }
    maps = outfits.baked_maps(unit, "MI_Custom")
    orm = maps["data"].pixels
    assert orm is not None and orm[0, 1].tolist() == [252, 255, 255], "occlusion, G=B=1"
    result = outfits.convert_material(
        unit, "MI_Custom", outfits.TextureWriter(tmp_path / "web"), {}
    )
    gltf_pbr = result.gltf["pbrMetallicRoughness"]
    assert gltf_pbr["metallicFactor"] == 0.0, "not rendered fully metallic"
    assert gltf_pbr["roughnessFactor"] == 0.5
    assert gltf_pbr["baseColorFactor"] == [0.5, 1.0, 1.0, 1.0]
    assert "orm" in result.textures, "the occlusion map is kept"
