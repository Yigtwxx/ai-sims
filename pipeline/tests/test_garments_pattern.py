import numpy as np
import pytest

from asset_pipeline.garments import GarmentError
from asset_pipeline.garments.body import (
    BaseBody,
    Section,
    convex_hull,
    is_arm_joint,
    landmarks,
    offset_hull,
    section,
)
from asset_pipeline.garments.pattern import (
    GridPanel,
    Weld,
    assemble,
    boundary_path,
    ray_hit,
    resample,
    shelf_pack,
)
from asset_pipeline.garments.skirt import BACK_LEFT, BACK_RIGHT, FRONT, draft_pencil_skirt


def circle(radius, count=64, center=(0.0, 0.0)):
    a = np.linspace(0, 2 * np.pi, count, endpoint=False)
    return np.stack([center[0] + radius * np.cos(a), center[1] + radius * np.sin(a)], 1)


def test_arm_joints_leave_out_toes():
    assert is_arm_joint("upperarm_l")
    assert is_arm_joint("ring_02_r")
    assert is_arm_joint("lowerarm_twist_01_l")
    assert not is_arm_joint("ringtoe_01_l")
    assert not is_arm_joint("thigh_r")
    assert not is_arm_joint("spine_03")


def test_hull_is_counter_clockwise_seen_from_above():
    hull = convex_hull(circle(1.0, 16))
    # Seen from +y with x to the right, +z points down the screen: counter-clockwise there
    # is clockwise in the (x, z) plane, i.e. a negative signed area.
    x, z = hull[:, 0], hull[:, 1]
    assert 0.5 * np.sum(x * np.roll(z, -1) - np.roll(x, -1) * z) < 0


def test_offset_hull_grows_perimeter_by_two_pi_d():
    hull = convex_hull(circle(0.15, 128))
    grown = offset_hull(hull, 0.01, segments=256)
    p0 = Section(0.0, hull).perimeter
    p1 = Section(0.0, grown).perimeter
    assert p1 - p0 == pytest.approx(2 * np.pi * 0.01, rel=0.01)


def test_section_needs_body_at_that_height():
    points = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]])
    with pytest.raises(GarmentError):
        section(points, 0.5)


def test_ray_hit_and_boundary_path_on_a_square():
    square = np.array([[-1.0, -1.0], [1.0, -1.0], [1.0, 1.0], [-1.0, 1.0]])
    origin = np.zeros(2)
    right = ray_hit(square, origin, np.array([1.0, 0.0]))
    top = ray_hit(square, origin, np.array([0.0, 1.0]))
    assert np.allclose(right[0], [1.0, 0.0])
    assert np.allclose(top[0], [0.0, 1.0])
    forward = boundary_path(square, right, top, forward=True)
    backward = boundary_path(square, right, top, forward=False)
    length = lambda p: np.linalg.norm(np.diff(p, axis=0), axis=1).sum()  # noqa: E731
    assert length(forward) == pytest.approx(2.0)
    assert length(backward) == pytest.approx(6.0)


def test_resample_is_even_along_the_path():
    path = np.array([[0.0, 0.0], [1.0, 0.0], [1.0, 2.0]])
    points, arcs = resample(path, 7)
    assert np.allclose(arcs, np.linspace(0, 3, 7))
    assert np.allclose(points[2], [1.0, 0.0])
    assert np.allclose(points[-1], [1.0, 2.0])


def test_shelf_pack_keeps_pieces_apart():
    sizes = [(0.5, 0.6), (0.3, 0.6), (0.3, 0.6)]
    offsets, side = shelf_pack(sizes, 0.02)
    boxes = [(o[0], o[1], o[0] + w, o[1] + h) for o, (w, h) in zip(offsets, sizes, strict=True)]
    for i, a in enumerate(boxes):
        assert a[2] <= side and a[3] <= side
        for b in boxes[i + 1 :]:
            assert a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1]


def tube_panel(name, rows, cols, start, stop, radius=1.0):
    """A grid on a vertical cylinder from angle `start` to `stop`."""
    a = np.linspace(start, stop, cols)
    y = np.arange(rows, dtype=float)
    points = np.stack(
        [
            np.broadcast_to(radius * np.sin(a), (rows, cols)),
            np.broadcast_to(y[:, None], (rows, cols)),
            np.broadcast_to(radius * np.cos(a), (rows, cols)),
        ],
        -1,
    )
    flat = np.stack(
        [np.broadcast_to(a * radius, (rows, cols)), np.broadcast_to(y[:, None], (rows, cols))], -1
    )
    return GridPanel(name, points, flat)


def test_assemble_welds_seams_and_faces_point_out():
    front = tube_panel("front", 4, 5, -np.pi / 2, np.pi / 2)
    back = tube_panel("back", 4, 5, np.pi / 2, 3 * np.pi / 2)
    mesh = assemble(
        [front, back], [Weld("front", 4, "back", 0, (0, 4)), Weld("front", 0, "back", 4, (0, 2))]
    )
    # 4 x 5 + 4 x 5 nodes, minus one welded column and half of the other.
    assert len(mesh.positions) == 40 - 4 - 2
    p = mesh.positions[mesh.faces]
    normals = np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0])
    away = p.mean(1)
    away[:, 1] = 0
    assert (np.einsum("ij,ij->i", normals, away) > 0).all()
    assert mesh.corner_uvs.shape == (len(mesh.faces), 3, 2)
    assert mesh.corner_uvs.min() >= 0 and mesh.corner_uvs.max() <= 1


def test_weld_needs_the_earlier_panel_first():
    front = tube_panel("front", 2, 3, 0, 1)
    back = tube_panel("back", 2, 3, 1, 2)
    with pytest.raises(GarmentError):
        assemble([front, back], [Weld("back", 0, "front", 2, (0, 2))])


def synthetic_body():
    """Two leg cylinders under a torso cylinder that narrows at the waist; no arms."""
    rings = []
    for y in np.arange(0.0, 1.45, 0.01):
        if y < 0.75:
            for cx in (-0.09, 0.09):
                rings.append(
                    np.column_stack(
                        [cx + circle(0.07, 24)[:, 0], np.full(24, y), circle(0.07, 24)[:, 1]]
                    )
                )
        else:
            r = 0.17 - 0.06 * np.exp(-(((y - 1.1) / 0.08) ** 2)) - 0.0 * y
            r += 0.01 * np.exp(-(((y - 0.85) / 0.06) ** 2))
            c = circle(r, 48)
            rings.append(np.column_stack([c[:, 0], np.full(48, y), c[:, 1]]))
    positions = np.concatenate(rings)
    return BaseBody(positions, np.zeros((0, 3), np.int64), np.zeros(len(positions), bool))


def test_landmarks_on_a_synthetic_body():
    marks = landmarks(synthetic_body())
    assert marks.waist == pytest.approx(1.1, abs=0.02)
    assert marks.hip == pytest.approx(0.85, abs=0.03)


def test_pencil_skirt_draft_is_outside_the_body_and_welded():
    body = synthetic_body()
    draft = draft_pencil_skirt(body)
    mesh = draft.mesh
    # Every node sits outside the body's hull at its height.
    for y in draft.heights[:: max(1, len(draft.heights) // 8)]:
        ring = mesh.positions[np.abs(mesh.positions[:, 1] - y) < 1e-6]
        hull = section(body.positions, float(y)).hull
        center = hull.mean(0)
        reach = np.linalg.norm(hull - center, axis=1).min()
        assert (np.linalg.norm(ring[:, [0, 2]] - center, axis=1) > reach).all()
    # Side seams are shared; the centre back is open over the slit only.
    rows = len(draft.heights)
    front, left, right = (mesh.panel_uvs[n] for n in (FRONT, BACK_LEFT, BACK_RIGHT))
    assert front.shape[0] == left.shape[0] == right.shape[0] == rows
    cols = front.shape[1] + left.shape[1] + right.shape[1]
    assert len(mesh.positions) == rows * cols - 2 * rows - (rows - draft.slit_rows)
    assert (mesh.pin[mesh.positions[:, 1] > draft.heights[draft.waist_row] - 1e-6] == 1).all()
    assert draft.slit_rows > 0
