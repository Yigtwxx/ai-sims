import io
import json
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from asset_pipeline.mh import outfits
from asset_pipeline.mh.convert import archive_root
from asset_pipeline.mh.glb import read_glb, view_bytes
from asset_pipeline.mh.outfit_udim import (
    AtlasLayout,
    UdimError,
    Zone,
    compose_atlas,
    is_khaos,
    is_udim_material,
    khaos_atlas,
    khaos_tile_maps,
    khaos_zones,
    plan_atlas,
    rebuild_normal,
    remap_uvs,
    scalar_modifier,
    tile_cell,
    tile_file,
    tile_number,
    triangle_tiles,
)


def test_tile_numbers_follow_mari_layout():
    assert tile_number(0, 0) == 1001
    assert tile_number(2, 1) == 1013
    assert tile_cell(1013) == (2, 1)
    with pytest.raises(UdimError):
        tile_number(10, 0)


@pytest.mark.parametrize(
    ("count", "grid", "cell"),
    [(1, (1, 1), 2048), (2, (2, 1), 2048), (3, (2, 2), 2048), (4, (2, 2), 2048), (5, (4, 2), 1024)],
)
def test_plan_atlas_keeps_the_outfit_texel_density_while_it_fits(count, grid, cell):
    layout = plan_atlas([1001 + i for i in range(count)])
    assert (layout.columns, layout.rows) == grid, f"{count} tiles -> {layout}"
    assert layout.cell == cell
    assert max(layout.width, layout.height) <= 4096


def test_plan_atlas_orders_tiles_and_finds_their_cells():
    layout = plan_atlas([1011, 1001, 1002, 1001])
    assert layout.tiles == (1001, 1002, 1011)
    assert [layout.position(t) for t in layout.tiles] == [(0, 0), (1, 0), (0, 1)]
    assert layout.as_dict()["size"] == [4096, 4096]


def test_triangle_tiles_use_the_centroid_so_edge_vertices_stay_with_their_island():
    uvs = np.array([[0.5, 0.5], [1.0, 0.5], [1.0, 0.9], [1.5, 0.5], [1.9, 0.9]])
    triangles = np.array([[0, 1, 2], [1, 3, 4]])
    assert triangle_tiles(uvs, triangles).tolist() == [1001, 1002]


def test_remap_uvs_moves_each_tile_into_its_cell():
    uvs = np.array([[0.25, 0.5], [0.75, 0.5], [0.5, 0.75], [1.25, 0.5], [1.75, 0.5], [1.5, 0.75]])
    triangles = np.array([[0, 1, 2], [3, 4, 5]])
    layout = AtlasLayout((1001, 1002), 2, 1, 2048)
    remapped = remap_uvs(uvs, triangles, layout)
    expected = np.array(
        [[0.125, 0.5], [0.375, 0.5], [0.25, 0.75], [0.625, 0.5], [0.875, 0.5], [0.75, 0.75]]
    )
    np.testing.assert_allclose(remapped.uvs, expected)
    assert remapped.split == 0
    assert remapped.triangles.tolist() == triangles.tolist()


def test_remap_uvs_splits_a_vertex_shared_by_two_tiles():
    # Vertex 1 sits on the tile border and is used by triangles of both tiles.
    uvs = np.array([[0.5, 0.2], [1.0, 0.5], [0.5, 0.8], [1.5, 0.2], [1.5, 0.8]])
    triangles = np.array([[0, 1, 2], [1, 3, 4]])
    remapped = remap_uvs(uvs, triangles, AtlasLayout((1001, 1002), 2, 1, 2048))
    assert remapped.split == 1
    assert remapped.source.tolist() == [0, 1, 2, 3, 4, 1]
    assert remapped.triangles.tolist() == [[0, 1, 2], [5, 3, 4]]
    np.testing.assert_allclose(remapped.uvs[1], [0.5, 0.5])  # right edge of cell 1001
    np.testing.assert_allclose(remapped.uvs[5], [0.5, 0.5])  # left edge of cell 1002


def test_remap_uvs_rejects_tiles_outside_the_atlas():
    uvs = np.array([[2.1, 0.1], [2.9, 0.1], [2.5, 0.9]])
    with pytest.raises(UdimError):
        remap_uvs(uvs, np.array([[0, 1, 2]]), AtlasLayout((1001,), 1, 1, 2048))


def test_compose_atlas_places_cells_and_fills_the_rest():
    layout = AtlasLayout((1001, 1002, 1011), 2, 2, 2)
    cells = {t: np.full((2, 2, 3), v, dtype=np.uint8) for t, v in ((1001, 10), (1011, 30))}
    atlas = compose_atlas(layout, cells, (1, 2, 3))
    assert atlas.shape == (4, 4, 3)
    assert atlas[0, 0].tolist() == [10, 10, 10]
    assert atlas[0, 2].tolist() == [1, 2, 3], "tile 1002 has no map: fill"
    assert atlas[2, 0].tolist() == [30, 30, 30]
    assert atlas[2, 2].tolist() == [1, 2, 3], "the fourth cell is unused"


def test_scalar_modifier_matches_the_khaos_function():
    value = np.array([0.4, 0.4, 0.4], dtype=np.float32)
    mask = np.array([1.0, 0.5, 0.0], dtype=np.float32)
    np.testing.assert_allclose(scalar_modifier(value, 0.5, mask), value)
    np.testing.assert_allclose(scalar_modifier(value, 0.75, mask), [0.7, 0.55, 0.4], rtol=1e-6)
    np.testing.assert_allclose(scalar_modifier(value, 0.25, mask), [0.2, 0.3, 0.4], rtol=1e-6)
    np.testing.assert_allclose(scalar_modifier(value, 0.0, mask), [0.0, 0.2, 0.4], rtol=1e-6)


def test_khaos_zones_read_tints_and_modifiers_in_graph_order():
    material = {
        "vectors": {"M2 Tint": "(R=1.000000,G=0.135633,B=0.450786,A=1.000000)", "UDIM Size": "x"},
        "scalars": {
            "M1 Roughness Modifier": 0.7,
            "M3 Metallic Modifier": 0.5,
            "Texture Set Size": 1,
        },
    }
    zones = khaos_zones(material)
    assert [z.index for z in zones] == [1, 2, 3]
    assert zones[0].tint == (1.0, 1.0, 1.0) and zones[0].roughness == 0.7
    assert zones[1].tint == pytest.approx((1.0, 0.135633, 0.450786))
    assert zones[2].specular == 0.5


def _khaos_material(**overrides):
    material = {
        "parents": [
            "/Game/X/MI_X.MI_X",
            "/Game/X/M_KhaosMDF1_AssetMaster_Opaque.M_KhaosMDF1_AssetMaster_Opaque",
        ],
        "textures": {name: f"/Game/X/{name}" for name in ("Base Color", "Masks 1 - 4", "SRMD")},
        "scalars": {"Texture Set Index": 0.0},
    }
    material["textures"]["Normal"] = "/Game/X/N"
    material["textures"]["Bent Normal/AO"] = "/Game/X/BO"
    material.update(overrides)
    return material


def test_is_khaos_needs_the_master_its_maps_and_texture_set_zero():
    assert is_khaos(_khaos_material())
    assert not is_khaos(_khaos_material(parents=["/Game/X/M_fabric_simpler.M_fabric_simpler"]))
    assert not is_khaos(_khaos_material(scalars={"Texture Set Index": 2.0}))
    no_srmd = _khaos_material()
    del no_srmd["textures"]["SRMD"]
    assert not is_khaos(no_srmd)


def test_udim_lookup_reads_tiles_and_repeats_plain_maps():
    textures = {
        "/Game/X/BC": {"udim": {"1001": "BC.1001.png", "1002": "BC.1002.png"}},
        "/Game/X/E": {"file": "E.png"},
        "/Game/X/Missing": {"error": "No exporter wrote it"},
    }
    material = {"textures": {"Base Color": "/Game/X/BC", "Emissive": "/Game/X/E"}}
    assert is_udim_material(material, textures)
    assert not is_udim_material({"textures": {"Emissive": "/Game/X/E"}}, textures)
    assert tile_file(textures, "/Game/X/BC", 1002) == "BC.1002.png"
    assert tile_file(textures, "/Game/X/BC", 1003) is None
    assert tile_file(textures, "/Game/X/E", 1002) == "E.png"
    assert tile_file(textures, "/Game/X/Missing", 1001) is None


def test_rebuild_normal_restores_z_of_two_channel_maps():
    pixels = np.zeros((1, 2, 4), dtype=np.uint8)
    pixels[0, 0] = (128, 128, 0, 255)  # flat
    pixels[0, 1] = (218, 128, 0, 255)  # tilted along +X
    normal = rebuild_normal(pixels)
    np.testing.assert_allclose(np.linalg.norm(normal, axis=-1), 1.0, atol=1e-5)
    assert normal[0, 0, 2] == pytest.approx(1.0, abs=1e-3)
    assert 0.6 < normal[0, 1, 2] < 0.8 and normal[0, 1, 0] > 0.6


def _sources(size, base=200, mask_g=255, srmd=(128, 100, 0, 0), ao=200):
    full = (size, size)
    return {
        "Base Color": np.full((*full, 3), base, dtype=np.uint8),
        "Masks 1 - 4": np.stack(
            [np.zeros(full), np.full(full, mask_g), np.zeros(full), np.zeros(full)], -1
        ).astype(np.uint8),
        "SRMD": np.broadcast_to(np.asarray(srmd, np.uint8), (*full, 4)).copy(),
        "Bent Normal/AO": np.broadcast_to(np.asarray((128, 128, 255, ao), np.uint8), (*full, 4)),
        "Normal": np.broadcast_to(np.asarray((128, 128, 0, 255), np.uint8), (*full, 4)),
    }


def test_khaos_tile_maps_tint_the_masked_zone_and_pack_orm():
    zones = [
        Zone(1, (0.0, 0.0, 0.0), 0.5, 0.5, 0.5),  # mask R is empty: no effect
        Zone(2, (1.0, 0.5, 0.25), 0.5, 0.75, 0.5),
    ]
    maps = khaos_tile_maps(_sources(8), zones, 4)
    assert {k: v.shape for k, v in maps.items()} == {
        "color": (4, 4, 3),
        "data": (4, 4, 3),
        "normal": (4, 4, 3),
    }
    base = 0.5776  # sRGB 200 in linear light
    expected = [base * 1.0, base * 0.5, base * 0.25]
    from asset_pipeline.mh.textures import srgb_to_linear

    np.testing.assert_allclose(srgb_to_linear(maps["color"][0, 0]), expected, atol=0.01)
    roughness = 100 / 255 + (1 - 100 / 255) * 0.5
    assert maps["data"][0, 0].tolist() == [200, round(roughness * 255), 0]
    assert maps["normal"][0, 0].tolist() == [128, 128, 255]


def _write_png(path: Path, pixels: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(pixels).save(path)


def test_khaos_atlas_builds_every_tile_and_reports_missing_ones(tmp_path):
    sources = _sources(8)
    textures, material = {}, _khaos_material()
    for name, pixels in sources.items():
        reference = material["textures"][name]
        tiles = {}
        for tile, shade in ((1001, 0), (1002, 40)):
            file = f"{name.replace(' ', '_').replace('/', '_')}.{tile}.png"
            shaded = pixels.copy()
            if name == "Base Color":
                shaded = np.clip(shaded.astype(int) - shade, 0, 255).astype(np.uint8)
            _write_png(tmp_path / "textures" / file, shaded)
            tiles[str(tile)] = file
        textures[reference] = {"udim": tiles}
    layout = AtlasLayout((1001, 1002, 1011), 2, 2, 4)
    maps, missing = khaos_atlas(tmp_path, material, textures, layout, {})
    assert missing == [1011]
    color = maps["color"].pixels
    assert color.shape == (8, 8, 3)
    assert color[0, 0, 0] > color[0, 4, 0], "tile 1002 is darker"
    assert color[4, 0].tolist() == [128, 128, 128], "tile 1011 keeps the fill"
    assert len({m.sha256 for m in maps.values()}) == 3


# ---------------------------------------------------------------------------- real export


@pytest.mark.parametrize("item", ["KhaosMDF492", "KhaosMDF503"])
def test_khaos_recipe_matches_unreal_tile_1001_bake_real(item):
    unit = archive_root() / "raw" / "outfits" / "female" / f"WI_{item}"
    if not (unit / "done.json").is_file():
        pytest.skip(f"no {unit.name} export")
    info = json.loads((unit / "outfit.json").read_text(encoding="utf-8"))
    ((_, material),) = info["materials"].items()
    layout = AtlasLayout((1001,), 1, 1, 512)
    maps, missing = khaos_atlas(unit, material, info["textures"], layout, {})
    assert not missing
    document, binary = read_glb((unit / "OutfitBase_female_Outfits.baked.glb").read_bytes())
    baked = document["materials"][0]["pbrMetallicRoughness"]

    def image(slot: dict) -> np.ndarray:
        source = document["images"][document["textures"][slot["index"]]["source"]]
        with Image.open(io.BytesIO(view_bytes(document, binary, source["bufferView"]))) as im:
            return np.asarray(im.convert("RGB").resize((512, 512), Image.Resampling.BOX), float)

    color = np.abs(maps["color"].pixels.astype(float) - image(baked["baseColorTexture"]))
    assert color.mean() < 4.0, f"colour differs by {color.mean():.2f} levels"
    rough = maps["data"].pixels[..., 1:].astype(float)
    metal_rough = image(baked["metallicRoughnessTexture"])[..., 1:]
    assert np.abs(rough - metal_rough).mean() < 3.0


# ---------------------------------------------------------------------------- converter


def _udim_unit(folder: Path) -> "outfits.OutfitUnit":
    material = _khaos_material(vectors={"M2 Tint": "(R=1.0,G=0.5,B=0.25,A=1.0)"})
    textures = {}
    ramp = np.linspace(40, 220, 8, dtype=np.uint8)[None, :, None]
    for name, pixels in _sources(8).items():
        reference = material["textures"][name]
        pixels = pixels.copy()
        pixels[..., :2] = ramp  # varied maps: flat ones collapse to constants
        tiles = {}
        for tile in (1001, 1002):
            file = f"{name.replace(' ', '_').replace('/', '_')}.{tile}.png"
            _write_png(folder / "textures" / file, np.ascontiguousarray(pixels))
            tiles[str(tile)] = file
        textures[reference] = {"udim": tiles, "srgb": name == "Base Color"}
    info = {"materials": {"/Game/X/MI_Khaos.MI_Khaos": material}, "textures": textures}
    (folder / "outfit.json").write_text(json.dumps(info), encoding="utf-8")
    (folder / "done.json").write_text(json.dumps({"files": []}), encoding="utf-8")
    return outfits.OutfitUnit.load(folder, "female")


def _part(material: str, uvs: list[list[float]]) -> "outfits.GarmentPart":
    count = len(uvs)
    return outfits.GarmentPart(
        material=material,
        positions=np.arange(count * 3, dtype=np.float64).reshape(count, 3),
        normals=np.tile([0.0, 0.0, 1.0], (count, 1)),
        uvs=np.asarray(uvs, dtype=np.float64),
        triangles=np.arange(count, dtype=np.int64).reshape(-1, 3),
    )


def test_pack_udim_parts_moves_only_khaos_parts_past_tile_1001(tmp_path):
    unit = _udim_unit(tmp_path / "WI_KhaosMDF1")
    two_tiles = _part(
        "MI_Khaos", [[0.2, 0.2], [0.8, 0.2], [0.5, 0.8], [1.2, 0.2], [1.8, 0.2], [1.5, 0.8]]
    )
    other = _part("MI_Other", [[1.2, 0.2], [1.8, 0.2], [1.5, 0.8]])
    garment = outfits.Garment(parts=[two_tiles, other])
    layouts = outfits.pack_udim_parts(unit, garment)
    assert set(layouts) == {"MI_Khaos"}
    assert layouts["MI_Khaos"].as_dict()["size"] == [4096, 2048]
    assert two_tiles.uvs.max() <= 1.0 and two_tiles.uvs[3, 0] == pytest.approx(0.6)
    assert other.uvs[0, 0] == pytest.approx(1.2), "non-Khaos parts keep their UVs"


def test_convert_material_uses_the_atlas_instead_of_the_bake(tmp_path, monkeypatch):
    encoded: dict[str, np.ndarray] = {}

    def fake_encode(image: np.ndarray, output: Path, settings: object) -> int:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(b"KTX2")
        encoded[output.name] = image
        return 4

    monkeypatch.setattr(outfits, "encode_ktx2", fake_encode)
    unit = _udim_unit(tmp_path / "WI_KhaosMDF1")
    layout = AtlasLayout((1001, 1002), 2, 1, 4)
    writer = outfits.TextureWriter(tmp_path / "web")
    result = outfits.convert_material(unit, "MI_Khaos", writer, {}, layout)
    assert result.extras["udim"]["size"] == [8, 4]
    assert result.extras["udim"]["missing_tiles"] == []
    assert set(result.textures) == {"color", "normal", "orm"}
    assert result.gltf["pbrMetallicRoughness"]["baseColorFactor"] == [1.0, 1.0, 1.0, 1.0]
    color = next(v for k, v in encoded.items() if "udim_color" in k)
    assert color.shape == (4, 8, 3), "the atlas keeps both cells (no square downsizing)"
    assert "baked" not in result.extras
