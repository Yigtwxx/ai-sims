"""Groom cards: surface queries, groom-head correspondence and card binding."""

from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from asset_pipeline.mh import grooms
from asset_pipeline.mh.dna import read_dna
from asset_pipeline.mh.geometry import closest_point_on_triangles, closest_triangles, components
from asset_pipeline.mh.grooms import (
    Binding,
    CardMesh,
    GroomError,
    GroomHead,
    GroomUnit,
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


def _cardless_unit(tmp_path: Path, baked: bool) -> GroomUnit:
    unit = tmp_path / "raw" / "grooms" / "Beards" / "Beard_S_Stubble"
    (unit / "textures").mkdir(parents=True)
    (unit / "cards.json").write_text("{}", encoding="utf-8")
    Image.new("RGB", (64, 64), (90, 80, 70)).save(unit / "textures" / "Beard_S_Stubble_Thumb.png")
    if baked:
        pixels = np.zeros((64, 64, 4), dtype=np.uint8)
        pixels[20:40, 10:50] = (128, 128, 40, 200)
        Image.fromarray(pixels).save(unit / "textures" / "Beard_S_Stubble_baked.png")
    return GroomUnit.load(unit)


def test_cardless_grooms_are_painted_from_their_baked_map(tmp_path: Path, monkeypatch) -> None:
    written: dict[str, np.ndarray] = {}

    def fake_encode(image: np.ndarray, output: Path, settings: object) -> int:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(b"KTX2")
        written[output.name] = image
        return 4

    monkeypatch.setattr(grooms, "encode_ktx2", fake_encode)
    web = tmp_path / "web"
    entry, outputs, stats = grooms.convert_groom(_cardless_unit(tmp_path, True), {}, None, web)
    assert entry["painted"] == "grooms/beard/Beard_S_Stubble/baked.ktx2", entry
    assert "glb" not in entry, "painted grooms have no cards"
    assert written["baked.ktx2"].shape == (64, 64, 4), "coverage (alpha) is kept"
    assert entry["thumbnail"] == "grooms/beard/Beard_S_Stubble/thumbnail.webp"
    assert all(path.is_file() for path in outputs) and stats["painted"]


def test_cardless_grooms_without_a_baked_map_fail(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(grooms, "encode_ktx2", lambda image, output, settings: 0)
    with pytest.raises(GroomError, match="no baked"):
        grooms.convert_groom(_cardless_unit(tmp_path, False), {}, None, tmp_path / "web")


def test_groom_density_joins_the_baked_cover_beyond_the_roots() -> None:
    # Every strand grows from head UV (0.25, 0.25), as an updo's do from its hairline...
    roots = np.zeros((64, 64, 4), dtype=np.uint8)
    roots[..., 0] = roots[..., 1] = 64
    roots[..., 3] = 255
    # ...while Unreal's baked map also covers the crown they are combed over.
    baked = np.zeros((32, 32), dtype=np.uint8)
    baked[24:, 24:] = 255
    density = grooms.groom_density(roots, baked)[..., 3]
    size = grooms.DENSITY_SIZE
    root_texel = density[size // 4, size // 4]
    crown_texel = density[size * 7 // 8, size * 7 // 8]
    bare_texel = density[size // 2, size * 7 // 8]
    assert root_texel == 255, f"roots stay full cover, got {root_texel}"
    assert crown_texel == 255, f"the baked cover is joined, got {crown_texel}"
    assert bare_texel == 0, f"skin neither map covers stays bare, got {bare_texel}"


def test_groom_density_without_a_baked_map_is_the_root_density() -> None:
    roots = np.zeros((64, 64, 4), dtype=np.uint8)
    roots[..., 0] = roots[..., 1] = 64
    roots[..., 3] = 255
    joined = grooms.groom_density(roots, None)
    alone = grooms.density_from_roots(roots)
    assert np.array_equal(joined, alone), "no baked map leaves the root density as it is"


def test_empty_skin_slots_point_at_a_skin_joint() -> None:
    # Joint 0 of the head is not in the groom skin; empty slots (weight 0) carry it.
    remap = np.array([-1, 0, 1, -1], dtype=np.int64)
    joints = np.array([[1, 2, 0, 0], [2, 0, 0, 0]], dtype=np.int64)
    weights = np.array([[0.7, 0.3, 0.0, 0.0], [1.0, 0.0, 0.0, 0.0]])
    local = grooms._local_joints(remap, joints, weights)
    assert local.dtype == np.uint16
    np.testing.assert_array_equal(local, [[0, 1, 0, 0], [1, 0, 0, 0]])
    with pytest.raises(ValueError):
        grooms._local_joints(remap, np.array([[3, 0, 0, 0]]), np.array([[1.0, 0, 0, 0]]))


@pytest.mark.parametrize(
    "file_name, role",
    [
        ("Hair_L_Straight_CardsAtlas_Attribute.png", "attribute"),
        ("Hair_L_HighPonytail_CardsAltas_Attribute.png", "attribute"),
        ("Hair_L_HighPonytail_CardsAtlas_Tangent.png", "tangent"),
    ],
)
def test_texture_roles_match_epic_atlas_names_including_typo(file_name, role):
    matched = [r for pattern, r, _, _ in grooms.TEXTURE_ROLES if pattern.search(file_name)]
    assert matched[:1] == [role], f"{file_name} matched {matched}"
