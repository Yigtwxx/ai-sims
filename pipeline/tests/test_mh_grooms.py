"""Groom cards: surface queries, groom-head correspondence and card binding."""

from pathlib import Path

import numpy as np
import pytest

from asset_pipeline.mh.dna import read_dna
from asset_pipeline.mh.geometry import closest_point_on_triangles, closest_triangles, components
from asset_pipeline.mh.grooms import (
    Binding,
    CardMesh,
    GroomHead,
    bind_cards,
)


def _grid(size: int = 6) -> tuple[np.ndarray, np.ndarray]:
    """A bumpy grid surface in the xz plane (y up)."""
    xs, zs = np.meshgrid(np.linspace(0, 1, size), np.linspace(0, 1, size))
    ys = 0.1 * np.sin(3 * xs) * np.cos(2 * zs)
    vertices = np.stack([xs.ravel(), ys.ravel(), zs.ravel()], axis=1)
    quads = [
        (r * size + c, r * size + c + 1, (r + 1) * size + c + 1, (r + 1) * size + c)
        for r in range(size - 1)
        for c in range(size - 1)
    ]
    triangles = np.array(
        [t for a, b, c, d in quads for t in ((a, b, c), (a, c, d))], dtype=np.int64
    )
    return vertices, triangles


def test_closest_point_on_triangles_matches_a_dense_search() -> None:
    rng = np.random.default_rng(4)
    a, b, c = (rng.normal(size=(500, 3)) for _ in range(3))
    points = rng.normal(size=(500, 3)) * 2
    closest, bary = closest_point_on_triangles(points, a, b, c)
    np.testing.assert_allclose(bary.sum(axis=1), 1.0, atol=1e-9)
    assert np.all(bary >= -1e-9)
    # No sampled point of the triangle is closer than the reported one.
    samples = rng.dirichlet(np.ones(3), size=400)
    candidates = (
        samples[None, :, :1] * a[:, None]
        + samples[None, :, 1:2] * b[:, None]
        + samples[None, :, 2:] * c[:, None]
    )
    sampled = np.linalg.norm(candidates - points[:, None], axis=2).min(axis=1)
    reported = np.linalg.norm(closest - points, axis=1)
    assert np.all(reported <= sampled + 1e-9)


def test_closest_triangles_matches_a_search_over_every_triangle() -> None:
    vertices, triangles = _grid()
    points = np.array([[0.31, 0.5, 0.42], [0.9, -0.2, 0.1], [0.5, 0.02, 0.5]])
    triangle, bary, distance = closest_triangles(points, vertices, triangles)
    surface = np.einsum("nk,nkj->nj", bary, vertices[triangles[triangle]])
    np.testing.assert_allclose(np.linalg.norm(surface - points, axis=1), distance, atol=1e-12)
    every = np.repeat(points, len(triangles), axis=0)
    tiled = np.tile(triangles, (len(points), 1))
    closest, _ = closest_point_on_triangles(
        every, vertices[tiled[:, 0]], vertices[tiled[:, 1]], vertices[tiled[:, 2]]
    )
    brute = np.linalg.norm(closest - every, axis=1).reshape(len(points), -1).min(axis=1)
    np.testing.assert_allclose(distance, brute, atol=1e-12)


def test_components_label_separate_cards() -> None:
    triangles = np.array([[0, 1, 2], [1, 3, 2], [4, 5, 6]], dtype=np.int64)
    labels = components(7, triangles)
    assert labels[0] == labels[3] != labels[4] == labels[6]


def test_cards_bind_by_their_root_and_follow_the_surface() -> None:
    vertices, triangles = _grid()
    head = GroomHead("synthetic", vertices, triangles, 1.0)
    # Two vertical cards standing on surface points (inside triangles 12 and 31).
    weights = np.array([[0.2, 0.3, 0.5], [0.6, 0.1, 0.3]])
    roots = np.einsum("nk,nkj->nj", weights, vertices[triangles[[12, 31]]])
    card = np.array([[0, 0, 0], [0.02, 0, 0], [0, 0.1, 0], [0.02, 0.1, 0]])
    positions = np.concatenate([roots[0] + card, roots[1] + card])
    indices = np.array([[0, 1, 2], [1, 3, 2], [4, 5, 6], [5, 7, 6]], dtype=np.int64)
    cards = CardMesh(positions, None, None, None, None, indices)
    binding = bind_cards(cards, head)
    assert isinstance(binding, Binding)
    assert binding.root_distance.max() < 1e-6
    np.testing.assert_allclose(binding.fit(vertices), positions, atol=1e-12)
    lifted = vertices + np.array([0.0, 0.05, 0.0])
    np.testing.assert_allclose(
        binding.fit(lifted) - positions, np.tile([0, 0.05, 0], (8, 1)), atol=1e-12
    )
    assert len(np.unique(binding.triangles[:4], axis=0)) == 1, "a card moves with one root"
    assert binding.attached.all(), "both cards grow from the surface"


@pytest.fixture(scope="module")
def ada_head_mesh(bindings, ada_head_path):
    dna = read_dna(ada_head_path, lods=[0], blend_shapes=False)
    return next(m for m in dna.meshes_for_lod(0) if m.name.startswith("head_"))


@pytest.mark.parametrize("name", ["SKM_Groom_Head_Legacy01", "SKM_Groom_Head_Legacy02"])
def test_groom_heads_match_the_dna_topology(archive: Path, ada_head_mesh, name: str) -> None:
    path = archive / "raw" / "grooms" / "groom_head" / f"{name}.glb"
    if not path.is_file():
        pytest.skip(f"{name} not exported")
    head = GroomHead.load(path, ada_head_mesh)
    assert head.edge_agreement > 0.98
    offset = head.positions - ada_head_mesh.positions / 100.0
    spread = np.linalg.norm(offset - np.median(offset, axis=0), axis=1)
    assert np.percentile(spread, 99) < 0.04, "same head layout, only the shape differs"
