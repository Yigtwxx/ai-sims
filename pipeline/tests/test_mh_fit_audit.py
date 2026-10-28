"""Fit audit geometry: signed distances, skin through cloth, morphs, skinning, rays."""

import numpy as np
import pytest

from asset_pipeline.mh.fit_audit import (
    HEAD_CLEARANCE,
    Cards,
    Skeleton,
    align_loops,
    apply_morphs,
    body_part,
    covered,
    decode_bitset,
    depth_stats,
    fit_over_head,
    layers_crossed,
    linear_blend_skin,
    ray_hits,
    refit_cards,
    sample_quaternion,
    signed_distance,
    skin_through,
    skin_to_head,
    slider_morph_weights,
    stacked_layers,
    winding_sign,
)
from asset_pipeline.mh.grooms import HeadFrame, SurfaceDepth
from asset_pipeline.mh.kinematics import axis_quaternions


def _sphere(radius: float = 0.1, rings: int = 24, segments: int = 48):
    """UV sphere with outward winding."""
    vertices = [[0.0, radius, 0.0]]
    for i in range(1, rings):
        theta = np.pi * i / rings
        for j in range(segments):
            phi = 2 * np.pi * j / segments
            vertices.append(
                [
                    radius * np.sin(theta) * np.cos(phi),
                    radius * np.cos(theta),
                    radius * np.sin(theta) * np.sin(phi),
                ]
            )
    vertices.append([0.0, -radius, 0.0])
    triangles = []
    for j in range(segments):
        triangles.append([0, 1 + (j + 1) % segments, 1 + j])
    for i in range(rings - 2):
        for j in range(segments):
            a = 1 + i * segments + j
            b = 1 + i * segments + (j + 1) % segments
            c = a + segments
            d = b + segments
            triangles += [[a, b, d], [a, d, c]]
    last = len(vertices) - 1
    base = 1 + (rings - 2) * segments
    for j in range(segments):
        triangles.append([last, base + j, base + (j + 1) % segments])
    return np.array(vertices), np.array(triangles, dtype=np.int64)


def _grid(size: float = 0.2, step: float = 0.01, z: float = 0.0, flip: bool = False):
    """Square sheet in the z plane centred on the origin, normal +z (or -z when flipped)."""
    n = round(size / step) + 1
    xs = np.linspace(-size / 2, size / 2, n)
    gx, gy = np.meshgrid(xs, xs, indexing="ij")
    vertices = np.stack([gx.ravel(), gy.ravel(), np.full(n * n, z)], axis=1)
    triangles = []
    for i in range(n - 1):
        for j in range(n - 1):
            a, b, c, d = i * n + j, (i + 1) * n + j, (i + 1) * n + j + 1, i * n + j + 1
            triangles += [[a, b, c], [a, c, d]]
    triangles = np.array(triangles, dtype=np.int64)
    return vertices, triangles[:, ::-1] if flip else triangles


def test_signed_distance_is_negative_inside_a_sphere() -> None:
    vertices, triangles = _sphere()
    outward = winding_sign(vertices, triangles, vertices / 0.1)
    assert outward == 1.0
    points = np.array([[0.0, 0.0, 0.05], [0.0, 0.0, 0.12], [0.08, 0.0, 0.0]])
    signed, square, _ = signed_distance(points, vertices, triangles, outward=outward)
    assert signed[0] == pytest.approx(-0.05, abs=1e-3)
    assert signed[1] == pytest.approx(0.02, abs=1e-3)
    assert signed[2] == pytest.approx(-0.02, abs=1e-3)
    assert np.all(square > 0.95)


def test_winding_sign_follows_the_stored_normals() -> None:
    vertices, triangles = _sphere()
    assert winding_sign(vertices, triangles[:, ::-1], vertices / 0.1) == -1.0
    assert winding_sign(vertices, triangles, None) == 1.0


def test_skin_through_counts_only_skin_outside_the_cloth_over_it() -> None:
    cloth, triangles = _grid()
    points = np.array(
        [
            [0.0, 0.0, -0.002],  # under the cloth
            [0.01, 0.02, 0.003],  # 3 mm through it
            [0.15, 0.0, 0.003],  # past the hem: skin meant to show
        ]
    )
    normals = np.tile([0.0, 0.0, 1.0], (3, 1))
    depth = skin_through(points, normals, cloth, triangles)
    assert depth[0] == 0.0
    assert depth[1] == pytest.approx(0.003, abs=1e-6)
    assert depth[2] == 0.0
    # A garment wound the other way says so through `winding`.
    flipped = skin_through(points, normals, *_grid(flip=True), winding=-1.0)
    assert np.allclose(flipped, depth)


def test_skin_with_the_body_between_it_and_the_cloth_is_not_through_it() -> None:
    # A toe top 2 cm above a sole: the toe's underside lies between them.
    sole, sole_triangles = _grid()
    underside, underside_triangles = _grid(z=0.005, flip=True)
    point = np.array([[0.01, 0.02, 0.02]])
    normal = np.array([[0.0, 0.0, 1.0]])
    alone = skin_through(point, normal, sole, sole_triangles)
    blocked = skin_through(
        point, normal, sole, sole_triangles, skin=(underside, underside_triangles)
    )
    assert alone[0] == pytest.approx(0.02, abs=1e-6)
    assert blocked[0] == 0.0


def test_skin_facing_the_inside_of_the_cloth_is_inside() -> None:
    # The cloth faces +z (its outside); skin behind it facing -z (the inner side of a
    # toe next to a shoe wall, skin under an inner lining) never shows through it.
    cloth, triangles = _grid()
    points = np.array([[0.0, 0.0, -0.01]])
    depth = skin_through(points, np.array([[0.0, 0.0, -1.0]]), cloth, triangles)
    assert depth[0] == 0.0


def test_an_outer_layer_covers_skin_through_the_inner_one() -> None:
    inner, inner_triangles = _grid()
    outer, outer_triangles = _grid(z=0.01)
    cloth = np.concatenate([inner, outer])
    triangles = np.concatenate([inner_triangles, outer_triangles + len(inner)])
    point = np.array([[0.01, 0.02, 0.003]])
    depth = skin_through(point, np.array([[0.0, 0.0, 1.0]]), cloth, triangles)
    assert depth[0] == 0.0


def test_skin_through_ignores_partners_far_from_the_neutral_one() -> None:
    cloth, triangles = _grid()
    point = np.array([[0.01, 0.02, 0.003]])
    normal = np.array([[0.0, 0.0, 1.0]])
    far = int(np.argmax(cloth[:, 0]))  # a corner 10 cm away
    near = int(np.argmin(np.linalg.norm(cloth - point, axis=1)))
    kept = skin_through(
        point, normal, cloth, triangles, partners=np.array([near]), garment_rest=cloth
    )
    dropped = skin_through(
        point, normal, cloth, triangles, partners=np.array([far]), garment_rest=cloth
    )
    assert kept[0] > 0 and dropped[0] == 0.0


def test_covered_skips_hems_and_skin_beside_the_cloth() -> None:
    cloth, triangles = _grid()
    points = np.array([[0.0, 0.0, -0.002], [0.0, 0.0, 0.004], [0.13, 0.0, 0.0]])
    normals = np.tile([0.0, 0.0, 1.0], (3, 1))
    mask, partner = covered(points, normals, cloth, triangles)
    assert mask.tolist() == [True, True, False]
    assert np.linalg.norm(cloth[partner[0]] - [0.0, 0.0, 0.0]) < 0.015


def test_ray_hits_a_sheet_within_reach_only() -> None:
    vertices, triangles = _grid(z=0.02)
    origins = np.array([[0.0, 0.0, 0.0], [0.0, 0.0, 0.0], [0.0, 0.0, 0.0], [0.3, 0.0, 0.0]])
    directions = np.array([[0, 0, 1.0], [0, 0, -1.0], [0, 0, 1.0], [0, 0, 1.0]])
    hits = ray_hits(origins[:2], directions[:2], vertices, triangles, reach=0.03)
    assert hits.tolist() == [True, False]
    assert not ray_hits(origins[2:3], directions[2:3], vertices, triangles, reach=0.01)[0]
    assert not ray_hits(origins[3:], directions[3:], vertices, triangles, reach=0.03)[0]


def test_slider_ends_and_morphs() -> None:
    weights = slider_morph_weights({"hips": -1.0, "weight": 0.5, "chest": 0.0, "waist": 2.0})
    assert weights == {"body_hips_min": 1.0, "body_weight_max": 0.5, "body_waist_max": 1.0}
    base = np.zeros((2, 3))
    morphs = {"body_hips_min": np.array([[0.0, 0.0, 0.01], [0.0, 0.0, 0.0]])}
    moved = apply_morphs(base, morphs, {"body_hips_min": 1.0, "body_unknown_max": 1.0})
    assert np.allclose(moved, [[0, 0, 0.01], [0, 0, 0]])
    assert np.all(base == 0)


def test_linear_blend_skinning_on_two_joints() -> None:
    skeleton = Skeleton(
        names=("root", "tip"),
        parents=np.array([-1, 0]),
        translations=np.array([[0.0, 0.0, 0.0], [0.0, 1.0, 0.0]]),
        rotations=np.array([[0.0, 0.0, 0.0, 1.0]] * 2),
        scales=np.ones((2, 3)),
    )
    rest = skeleton.world()
    rotations = skeleton.rotations.copy()
    rotations[1] = axis_quaternions("z", np.pi / 2)
    posed = skeleton.world(rotations=rotations)
    matrices = posed @ np.linalg.inv(rest)
    points = np.array([[0.0, 2.0, 0.0], [0.0, 2.0, 0.0], [0.0, 0.5, 0.0]])
    joints = np.array([[1, 0], [0, 1], [0, 1]])
    weights = np.array([[1.0, 0.0], [0.5, 0.5], [2.0, 0.0]])  # rows need not sum to 1
    moved = linear_blend_skin(points, joints, weights, matrices)
    assert np.allclose(moved[0], [-1.0, 1.0, 0.0])
    assert np.allclose(moved[1], [-0.5, 1.5, 0.0])
    assert np.allclose(moved[2], [0.0, 0.5, 0.0])


def test_fit_over_head_clears_the_head_skin() -> None:
    head, _ = _grid(size=0.1, step=0.005)
    normals = np.tile([0.0, 0.0, 1.0], (len(head), 1))
    garment = np.array([[0.0, 0.0, 0.001], [0.03, 0.0, -0.002], [0.0, 0.0, 0.2]])
    fitted = fit_over_head(garment, head, normals)
    assert fitted[0, 2] == pytest.approx(HEAD_CLEARANCE, abs=2e-4)
    assert fitted[1, 2] == pytest.approx(HEAD_CLEARANCE, abs=2e-4)
    assert np.allclose(fitted[2], garment[2])
    assert np.allclose(fitted[:2, :2], garment[:2, :2])


def test_fit_over_head_moves_stacked_layers_together() -> None:
    head, _ = _grid(size=0.1, step=0.005)
    normals = np.tile([0.0, 0.0, 1.0], (len(head), 1))
    garment = np.array([[0.0, 0.0, -0.002], [0.0, 0.0, 0.001]])  # inner band, outer band
    fitted = fit_over_head(garment, head, normals)
    assert fitted[0, 2] == pytest.approx(HEAD_CLEARANCE, abs=2e-4)
    assert fitted[1, 2] - fitted[0, 2] == pytest.approx(0.003, abs=1e-6)


def test_skin_to_head_takes_the_head_skin_near_the_head_only() -> None:
    head, _ = _grid(size=0.1, step=0.005)
    body = head + np.array([0.0, 0.0, -0.1])
    head_joints = np.tile([5, 0, 0, 0], (len(head), 1))
    head_weights = np.tile([1.0, 0, 0, 0], (len(head), 1))
    garment = np.array([[0.0, 0.0, 0.002], [0.0, 0.0, -0.098]])
    joints = np.tile([1, 2, 0, 0], (2, 1))
    weights = np.tile([0.5, 0.5, 0, 0], (2, 1))
    new_joints, new_weights = skin_to_head(
        garment, joints, weights, head, head_joints, head_weights, body
    )
    assert new_joints[0, 0] == 5 and new_weights[0, 0] == pytest.approx(1.0)
    assert new_joints[1].tolist() == [1, 2, 0, 0]
    assert np.allclose(new_weights[1], weights[1])


def test_layers_cross_when_the_inner_one_comes_out() -> None:
    inner, _ = _grid(size=0.02, step=0.01)
    outer = inner + np.array([0.0, 0.0, 0.002])
    garment = np.concatenate([inner, outer])
    body = inner - np.array([0.0, 0.0, 0.01])
    normals = np.tile([0.0, 0.0, 1.0], (len(body), 1))
    layers = stacked_layers(garment, body, normals, parts=["torso"] * len(garment))
    assert len(layers.inner) >= len(inner)
    assert set(layers.inner.tolist()) <= set(range(len(inner)))
    assert not layers_crossed(garment, normals, layers).any()
    swapped = garment.copy()
    swapped[0, 2] += 0.005  # the first inner vertex 3 mm out past the outer layer
    crossed = layers_crossed(swapped, normals, layers)
    assert crossed[0] == pytest.approx(0.003, abs=1e-6)
    assert np.count_nonzero(crossed) == 1
    # Panels of different body parts are never layers of one cloth.
    apart = stacked_layers(garment, body, normals, parts=["torso"] * 9 + ["arm_l"] * 9)
    assert len(apart.inner) == 0


def test_cards_refit_like_the_runtime() -> None:
    table = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [np.nan] * 3])
    cards = Cards(
        id="groom.hair.x",
        slot="hair",
        compat="unisex",
        fitted_to="Ada",
        positions=np.array([[9.0, 9.0, 9.0], [8.0, 8.0, 8.0]]),
        triangles=np.zeros((0, 3), dtype=np.int64),
        bind_positions=np.array([[0, 1, 2], [0, 1, 3]]),
        bind_weights=np.array([[0.5, 0.25, 0.25], [1.0, 0.0, 0.0]]),
        bind_offset=np.array([[0.0, 0.0, 0.01], [0.0, 0.0, 0.0]]),
        card=np.array([0, 0]),
        roots=np.array([0]),
    )
    points, missed = refit_cards(cards, table)
    assert np.allclose(points[0], [0.25, 0.25, 0.01])
    assert np.allclose(points[1], [8.0, 8.0, 8.0])  # binds a position the head lacks
    assert missed == 1


def _skin_patch(lift: float) -> tuple[np.ndarray, np.ndarray]:
    """A 3 x 3 grid of skin `lift` metres up (positions 0-8, normal +z; position 4 is
    inside, the rest on its open edge) and a root anchor below it (position 9)."""
    xs, ys = np.meshgrid(np.arange(3.0), np.arange(3.0))
    grid = np.stack([xs.ravel(), ys.ravel(), np.full(9, lift)], axis=1)
    table = np.vstack([grid, [[5.0, 5.0, -1.0]]])
    quads = [
        (r * 3 + c, r * 3 + c + 1, r * 3 + c + 4, r * 3 + c + 3) for r in (0, 1) for c in (0, 1)
    ]
    skin = np.array([t for a, b, c, d in quads for t in ((a, b, c), (a, c, d))])
    return table, skin


def test_cards_refit_keeps_the_designed_depth_like_the_runtime() -> None:
    surface = SurfaceDepth(
        position=np.array([4, 4]),
        depth=np.array([0.001, 0.003]),
        bound=np.array([True, True]),
        copy=np.array([False, False]),
        parent=np.array([-1, 0]),
    )
    at = np.array([[1.0, 1.0, 0.001], [1.1, 0.9, 0.003]])
    cards = Cards(
        id="groom.hair.x",
        slot="hair",
        compat="unisex",
        fitted_to="Ada",
        positions=np.zeros((2, 3)),
        triangles=np.array([[0, 1, 1]]),
        bind_positions=np.full((2, 3), 9),
        bind_weights=np.array([[1.0, 0.0, 0.0], [1.0, 0.0, 0.0]]),
        bind_offset=at - np.array([5.0, 5.0, -1.0]),
        card=np.array([0, 0]),
        roots=np.array([0]),
        surface=surface,
    )
    table, skin = _skin_patch(0.0)
    points, _ = refit_cards(cards, table, HeadFrame.build(table, skin))
    np.testing.assert_allclose(points[:, 2], [0.001, 0.003], atol=1e-12)
    raised, _ = _skin_patch(0.005)
    points, _ = refit_cards(cards, raised, HeadFrame.build(raised, skin))
    # The skin rose 5 mm under the card while its root stayed: both vertices come back
    # out to their designed height over it (within the 0.5 mm slack).
    np.testing.assert_allclose(points[:, 2], [0.0055, 0.0075], atol=1e-9)
    unchanged, _ = refit_cards(cards, raised)  # without a head frame: the root refit alone
    np.testing.assert_allclose(unchanged[:, 2], [0.001, 0.003], atol=1e-12)
    # Over the open edge of the skin a vertex keeps no depth of its own.
    edge = Cards(**{**cards.__dict__, "bind_offset": cards.bind_offset - [1.0, 1.0, 0.0]})
    points, _ = refit_cards(edge, raised, HeadFrame.build(raised, skin))
    np.testing.assert_allclose(points[:, 2], [0.001, 0.003], atol=1e-12)


def test_loops_pair_across_a_shift_and_a_reversal() -> None:
    angles = np.linspace(0, 2 * np.pi, 12, endpoint=False)
    loop = np.stack([np.cos(angles), np.sin(angles), np.zeros(12)], axis=1)
    other = np.roll(loop[::-1], 5, axis=0)
    mapping = align_loops(loop, other)
    assert np.allclose(other[mapping], loop)


def test_bitset_and_stats_helpers() -> None:
    flags = decode_bitset("BQ==", 10)  # 0b00000101
    assert flags.tolist() == [True, False, True] + [False] * 7
    stats = depth_stats(np.array([0.0, 0.002, 0.001]), ["a", "b", "b"])
    assert stats["count"] == 2 and stats["max_mm"] == 2.0 and stats["regions"] == {"b": 2}
    assert depth_stats(np.zeros(3)) == {"count": 0}


def test_body_parts_and_quaternion_samples() -> None:
    assert body_part("upperarm_twist_01_l") == "arm_l"
    assert body_part("calf_r") == "leg_r"
    assert body_part("spine_05") == "torso" and body_part("clavicle_l") == "torso"
    times = np.array([0.0, 1.0])
    values = np.array([[0.0, 0.0, 0.0, 1.0], [0.0, 0.0, 0.0, -1.0]])  # same rotation
    assert np.allclose(np.abs(sample_quaternion(times, values, 0.5)), [0, 0, 0, 1])
