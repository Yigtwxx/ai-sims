"""Outfit garments: body correspondence, cap removal, transfer, body_hide and materials."""

import base64
import json
from pathlib import Path

import numpy as np
import pytest

from asset_pipeline.mh import outfits
from asset_pipeline.mh.geometry import vertex_normals
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
