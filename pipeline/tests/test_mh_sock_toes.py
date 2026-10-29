from pathlib import Path

import numpy as np
import pytest

from asset_pipeline.mh.sock_toes import (
    FIELD_BLUR,
    MEET_SHARE,
    SockToes,
    envelope,
    read_sock_toes,
    toe_weights,
    unfold,
    write_sock_toes,
)

RADIUS = 0.004
#: Where nothing is closed, a vertex may still move by up to about a voxel.
VOXEL_TOLERANCE = 0.001


def box(lo: tuple[float, float, float], hi: tuple[float, float, float], n: int = 10):
    """A closed box surface: six welded-free grids of n x n quads, outward normals."""
    lo_a, hi_a = np.array(lo), np.array(hi)
    positions, normals, indices = [], [], []
    t = np.linspace(0.0, 1.0, n + 1)
    for axis in range(3):
        u_axis, v_axis = [a for a in range(3) if a != axis]
        for end, sign in ((lo_a[axis], -1.0), (hi_a[axis], 1.0)):
            base = len(positions)
            for i in range(n + 1):
                for j in range(n + 1):
                    p = np.empty(3)
                    p[axis] = end
                    p[u_axis] = lo_a[u_axis] + t[i] * (hi_a[u_axis] - lo_a[u_axis])
                    p[v_axis] = lo_a[v_axis] + t[j] * (hi_a[v_axis] - lo_a[v_axis])
                    positions.append(p)
                    normal = np.zeros(3)
                    normal[axis] = sign
                    normals.append(normal)
            for i in range(n):
                for j in range(n):
                    a = base + i * (n + 1) + j
                    b, c, d = a + 1, a + n + 1, a + n + 2
                    # Wind outward: the cross product of the two edges along the normal.
                    tri = [(a, c, b), (b, c, d)]
                    e1 = positions[c] - positions[a]
                    e2 = positions[b] - positions[a]
                    if np.dot(np.cross(e1, e2), normals[a]) < 0:
                        tri = [(a, b, c), (b, d, c)]
                    indices.extend(tri)
    return np.array(positions), np.array(normals), np.array(indices).ravel()


def merge(*meshes):
    positions, normals, indices, offset = [], [], [], 0
    for p, n, i in meshes:
        positions.append(p)
        normals.append(n)
        indices.append(i + offset)
        offset += len(p)
    return np.concatenate(positions), np.concatenate(normals), np.concatenate(indices)


def test_envelope_closes_the_gap_between_two_toes() -> None:
    # Two 10 mm "toes" 3 mm apart: the sock spans the gap, so their facing sides meet
    # in it all along, each a little past halfway (MEET_SHARE) so that they overlap.
    left = box((0.040, 0.0, 0.10), (0.050, 0.010, 0.11))
    right = box((0.053, 0.0, 0.10), (0.063, 0.010, 0.11))
    positions, normals, indices = merge(left, right)
    offsets, _ = envelope(
        positions, normals, indices, np.ones(len(positions)), radius=RADIUS, box_blur=FIELD_BLUR
    )
    moved = positions + offsets
    # Clear of the pair's own square edges, which the blurred field rounds.
    inner = (np.abs(positions[:, 1] - 0.005) < 0.0025) & (np.abs(positions[:, 2] - 0.105) < 0.0035)
    for face, toward in ((0.050, 1.0), (0.053, -1.0)):
        facing = inner & (np.abs(positions[:, 0] - face) < 1e-9)
        assert facing.any()
        expected = face + toward * 0.003 * MEET_SHARE
        miss = np.abs(moved[facing, 0] - expected).max()
        assert miss < 0.0006, f"the side at x={face} stops {miss * 1e3:.2f} mm short"
    outer = np.abs(positions[:, 0] - 0.040) < 1e-9
    shift = np.linalg.norm(offsets[outer], axis=1)
    assert shift.max() < VOXEL_TOLERANCE, f"an outer side moved {shift.max() * 1e3:.2f} mm"


def test_envelope_fills_the_notch_between_two_toe_tips() -> None:
    # The facing sides near the front of the gap come forwards onto the front of the
    # pair, not over or under it: the front stays whole, no notch between the tips.
    left = box((0.040, 0.0, 0.10), (0.050, 0.010, 0.11))
    right = box((0.053, 0.0, 0.10), (0.063, 0.010, 0.11))
    positions, normals, indices = merge(left, right)
    offsets, _ = envelope(
        positions, normals, indices, np.ones(len(positions)), radius=RADIUS, box_blur=FIELD_BLUR
    )
    moved = positions + offsets
    near_front = (
        ((np.abs(positions[:, 0] - 0.050) < 1e-9) | (np.abs(positions[:, 0] - 0.053) < 1e-9))
        & (positions[:, 2] > 0.1075)
        & (np.abs(positions[:, 1] - 0.005) < 0.0025)
    )
    assert near_front.any()
    behind = 0.11 - moved[near_front, 2]
    assert behind.max() < 0.0012, f"the front dips {behind.max() * 1e3:.2f} mm at the gap"


def test_envelope_keeps_a_convex_shape() -> None:
    positions, normals, indices = box((0.040, 0.0, 0.10), (0.052, 0.012, 0.112))
    offsets, _ = envelope(
        positions, normals, indices, np.ones(len(positions)), radius=RADIUS, box_blur=FIELD_BLUR
    )
    shift = np.linalg.norm(offsets, axis=1)
    assert shift.max() < 0.0003, f"max {shift.max() * 1e3:.2f} mm"


def test_envelope_rounds_a_toe_box_but_keeps_its_size() -> None:
    # A toe box of 40 x 20 x 40 mm under the default blur: its broad top stays where it
    # is, its corners round off as knit pulled over them does.
    positions, normals, indices = box((0.040, 0.0, 0.10), (0.080, 0.020, 0.14), n=20)
    offsets, _ = envelope(positions, normals, indices, np.ones(len(positions)), radius=RADIUS)
    shift = np.linalg.norm(offsets, axis=1)
    top = (np.abs(positions[:, 1] - 0.020) < 1e-9) & (
        np.linalg.norm(positions[:, [0, 2]] - [0.060, 0.120], axis=1) < 0.005
    )
    corner = np.linalg.norm(positions - [0.080, 0.020, 0.14], axis=1) < 1e-9
    assert shift[top].max() < 0.001, f"the top moved {shift[top].max() * 1e3:.2f} mm"
    assert shift[corner].min() > 0.002, f"a corner moved only {shift[corner].min() * 1e3:.2f} mm"


def test_envelope_leaves_unweighted_vertices_alone() -> None:
    left = box((0.040, 0.0, 0.10), (0.050, 0.010, 0.11))
    right = box((0.053, 0.0, 0.10), (0.063, 0.010, 0.11))
    positions, normals, indices = merge(left, right)
    offsets, new_normals = envelope(
        positions, normals, indices, np.zeros(len(positions)), radius=RADIUS
    )
    assert not offsets.any()
    assert np.array_equal(new_normals, normals)


def test_unfold_turns_no_triangle_over() -> None:
    # A fan of four triangles around a centre that an offset pushed past its rim.
    positions = np.array(
        [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [-1.0, 0.0, 0.0], [0.0, -1.0, 0.0]]
    )
    triangles = np.array([[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1]])
    offsets = np.zeros_like(positions)
    offsets[0] = [1.6, 0.0, 0.0]
    fixed = unfold(positions, offsets, triangles)
    moved = positions + fixed
    faces = np.cross(
        moved[triangles[:, 1]] - moved[triangles[:, 0]],
        moved[triangles[:, 2]] - moved[triangles[:, 0]],
    )
    assert np.all(faces[:, 2] > 0), "a triangle is still turned over"
    assert np.array_equal(fixed[1:], offsets[1:]), "the rim moved"


@pytest.mark.parametrize(
    ("name", "counts"),
    [
        ("bigtoe_01_l", True),
        ("ringtoe_02_r", True),
        ("ball_l", True),
        ("ring_01_l", False),
        ("foot_l", False),
    ],
)
def test_toe_weights_count_toe_and_ball_bones(name: str, counts: bool) -> None:
    names = ["pelvis", name]
    joints = np.array([[1, 0, 0, 0]])
    weights = np.array([[0.6, 0.4, 0.0, 0.0]])
    assert toe_weights(names, joints, weights)[0] == pytest.approx(0.6 if counts else 0.0)


def test_sock_toes_file_round_trips(tmp_path: Path) -> None:
    toes = SockToes(
        indices=np.array([3, 7], dtype=np.uint32),
        offsets=np.array([[0.001, 0.0, -0.002], [0.0, 0.0005, 0.0]], dtype=np.float32),
        normals=np.array([[0.1, 0.0, 0.0], [0.0, -0.2, 0.0]], dtype=np.float32),
    )
    path = tmp_path / "socks.bin"
    write_sock_toes(toes, path)
    back = read_sock_toes(path)
    assert path.stat().st_size == 12 + 2 * 28
    assert np.array_equal(back.indices, toes.indices)
    assert np.array_equal(back.offsets, toes.offsets)
    assert np.array_equal(back.normals, toes.normals)


def test_read_sock_toes_refuses_other_files(tmp_path: Path) -> None:
    path = tmp_path / "socks.bin"
    path.write_bytes(b"glTF" + bytes(8))
    with pytest.raises(ValueError, match="not a sock toes file"):
        read_sock_toes(path)
