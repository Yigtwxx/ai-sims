"""Strands painted on the head skin instead of carded (`strand_paint`), and the Alembic
reader that brings them."""

import numpy as np
import pytest

from asset_pipeline.mh.alembic import Curves, read_curves
from asset_pipeline.mh.geometry import components
from asset_pipeline.mh.grooms import CardMesh
from asset_pipeline.mh.strand_paint import (
    CARD_COVER,
    DEFAULT_WIDTH,
    PAINTS,
    Strands,
    card_groups,
    from_unreal,
    load_strands,
    paint_strands,
    under_cards,
)

SPAN = 0.5  # metres of skin per unit of head UV


def _flat_head(size: int = 41) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Flat skin in the xz plane (y up) with UV = (x, z) / SPAN; (positions, triangles,
    corner UVs)."""
    xs, zs = np.meshgrid(np.linspace(0, SPAN, size), np.linspace(0, SPAN, size))
    positions = np.stack([xs.ravel(), np.zeros(xs.size), zs.ravel()], axis=1)
    quads = [
        (r * size + c, r * size + c + 1, (r + 1) * size + c + 1, (r + 1) * size + c)
        for r in range(size - 1)
        for c in range(size - 1)
    ]
    triangles = np.array([t for a, b, c, d in quads for t in ((a, b, c), (a, c, d))])
    uvs = positions[:, [0, 2]] / SPAN
    return positions, triangles, uvs[triangles]


def _strands(name: str, *polylines: list[list[float]], width: float = 1e-4) -> Strands:
    points = np.concatenate([np.asarray(p, dtype=np.float64) for p in polylines])
    counts = np.array([len(p) for p in polylines], dtype=np.int64)
    return Strands(name, points, counts, np.full(len(points), width))


def _coverage_at(image: np.ndarray, u: float, v: float) -> int:
    size = image.shape[0]
    return int(image[int(v * size), int(u * size), 3])


def test_segments_stay_within_each_strand() -> None:
    strands = _strands("g", [[0, 0, 0]] * 3, [[1, 0, 0]], [[2, 0, 0]] * 2)
    np.testing.assert_array_equal(strands.segments, [[0, 1], [1, 2], [4, 5]])


def test_unreal_strands_turn_into_gltf_metres() -> None:
    curves = Curves(
        "/groom/strands/Shaved",
        np.array([[1.0, 2.0, 170.0], [1.0, 2.5, 171.0]], dtype=np.float32),
        np.array([2], dtype=np.int32),
        {"width": np.array([0.006, 0.0], dtype=np.float32)},
    )
    strands = from_unreal(curves)
    assert strands.name == "Shaved"
    np.testing.assert_allclose(strands.points, [[0.01, 1.70, 0.02], [0.01, 1.71, 0.025]])
    np.testing.assert_allclose(strands.widths, [0.00006, DEFAULT_WIDTH])


def test_cards_go_with_the_strands_they_were_made_from() -> None:
    short = _strands("Shaved", [[0, 0, 0], [0.01, 0, 0]])
    long = _strands("Long", [[1, 0, 0], [1, 0.05, 0]])
    card = np.array([[0, 0, 0], [0.01, 0, 0], [0, 0.002, 0], [0.01, 0.002, 0]])
    positions = np.concatenate([card, card + np.array([1, 0.01, 0])])
    indices = np.array([[0, 1, 2], [1, 3, 2], [4, 5, 6], [5, 7, 6]])
    labels = components(len(positions), indices)
    group, spread = card_groups(positions, labels, [short, long])
    assert group[labels[0]] == 0 and group[labels[4]] == 1
    assert spread < 0.02


def test_card_subset_keeps_whole_cards_renumbered() -> None:
    card = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]], dtype=np.float64)
    positions = np.concatenate([card, card + 5])
    indices = np.array([[0, 1, 2], [1, 3, 2], [4, 5, 6], [5, 7, 6]])
    uvs = np.arange(16, dtype=np.float64).reshape(8, 2)
    cards = CardMesh(positions, None, None, uvs, None, indices)
    kept = cards.subset(np.array([False] * 4 + [True] * 4))
    np.testing.assert_array_equal(kept.positions, card + 5)
    np.testing.assert_array_equal(kept.indices, [[0, 1, 2], [1, 3, 2]])
    np.testing.assert_array_equal(kept.uv0, uvs[4:])
    assert kept.normals is None


def test_painted_strands_cover_the_skin_they_lie_on() -> None:
    positions, triangles, corner_uvs = _flat_head()
    lying = _strands("Shaved", [[0.122, 0.001, 0.125], [0.128, 0.001, 0.125]])
    image = paint_strands(positions, triangles, corner_uvs, [lying], [], size=256)
    assert _coverage_at(image, 0.25, 0.25) > 0, "the strand is drawn where it lies"
    assert _coverage_at(image, 0.75, 0.75) == 0, "nothing elsewhere"
    assert image[..., :3].max() == 0, "coverage only, in A"


def test_carded_strands_paint_only_their_roots() -> None:
    positions, triangles, corner_uvs = _flat_head()
    # A spike rooted at UV (0.25, 0.25) with its first 2 mm on the skin, and a strand lying
    # 1 cm above the skin at UV (0.75, 0.75).
    spike = [[0.125, 0.0, 0.125], [0.125, 0.002, 0.127], [0.125, 0.05, 0.13]]
    lifted = [[0.37, 0.01, 0.375], [0.38, 0.01, 0.375]]
    long = _strands("Long", spike, lifted)
    image = paint_strands(positions, triangles, corner_uvs, [], [long], size=256)
    assert _coverage_at(image, 0.25, 0.25) > 0, "the root end is painted"
    assert _coverage_at(image, 0.75, 0.75) == 0, "hair off the skin is the cards' job"


def test_overlapping_strands_saturate_towards_full_cover() -> None:
    positions, triangles, corner_uvs = _flat_head()
    # On the line between two supersampled rows of one texel, so all its ink lands there.
    line = [[0.122, 0.0, 0.126], [0.128, 0.0, 0.126]]
    one = _strands("A", line, width=2e-4)
    many = _strands("A", *([line] * 40), width=2e-4)
    single = _coverage_at(
        paint_strands(positions, triangles, corner_uvs, [one], [], 256), 0.25, 0.25
    )
    stacked = _coverage_at(
        paint_strands(positions, triangles, corner_uvs, [many], [], 256), 0.25, 0.25
    )
    assert 0 < single < stacked
    assert stacked >= 250


def test_segments_across_a_uv_seam_are_not_drawn() -> None:
    positions, triangles, corner_uvs = _flat_head()
    # Shift the UVs of the right half by half the map: a segment crossing x = SPAN / 2
    # jumps across the map in UV and must not smear a line between the islands.
    right = positions[triangles][..., 0].mean(axis=1) > SPAN / 2
    corner_uvs = corner_uvs.copy()
    corner_uvs[right, :, 1] = (corner_uvs[right, :, 1] + 0.5) % 1.0
    crossing = _strands("Shaved", [[0.24, 0.0, 0.1], [0.26, 0.0, 0.1]])
    image = paint_strands(positions, triangles, corner_uvs, [crossing], [], size=256)
    assert image[..., 3].max() == 0


def test_card_cover_lies_under_the_paint() -> None:
    paint = np.zeros((8, 8, 4), dtype=np.uint8)
    paint[0, 0, 3] = 255
    density = np.zeros((4, 4, 4), dtype=np.uint8)
    density[..., 3] = 200
    joined = under_cards(paint, density)
    assert joined[0, 0, 3] == 255, "strands stay"
    expected = round(200 * CARD_COVER)
    assert joined[5, 5, 3] == expected, f"the cards' cover comes in at {expected}"


def test_nomad_strand_file_holds_the_long_and_shaved_groups(archive) -> None:
    paint = PAINTS["NomadWaveUndercut"]
    source = archive / "fab_extras" / paint.extras
    if not source.is_file():
        pytest.skip(f"no strand file {source}")
    groups = load_strands(paint, archive / "fab_extras")
    assert sorted(groups) == ["LongHair", "ShavedHair"]
    shaved, long = groups["ShavedHair"], groups["LongHair"]
    assert (len(shaved.counts), len(long.counts)) == (37578, 34280)
    for strands in (shaved, long):
        assert strands.counts.sum() == len(strands.points) == len(strands.widths)
    # The head sits about 1.6-1.85 m up the glTF Y axis.
    assert 1.5 < np.median(long.points[:, 1]) < 1.9
    shaved_ends = (
        shaved.points[np.cumsum(shaved.counts) - 1]
        - shaved.points[np.cumsum(shaved.counts) - shaved.counts]
    )
    assert np.median(np.linalg.norm(shaved_ends, axis=1)) < 0.015, "shaved strands are short"


def test_alembic_reader_rejects_other_files() -> None:
    with pytest.raises(ValueError, match="Ogawa"):
        read_curves(b"HDF5 is not Ogawa" + bytes(32))
