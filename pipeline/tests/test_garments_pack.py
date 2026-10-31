import hashlib
import json
from pathlib import Path

import numpy as np
import pytest

from asset_pipeline.garments.pack import GarmentLines, garment_maps, outfit_info
from asset_pipeline.mh.convert import archive_root
from asset_pipeline.mh.outfits import OutfitUnit, _is_unit


def template_info():
    return {
        "materials": {
            "/Game/Fab/x/MI_X.MI_X": {
                "parents": ["/Game/Fab/x/M_fabric_simpler.M_fabric_simpler"],
                "scalars": {
                    "DetailTex_UVTtiling": 100.0,
                    "B_DetailTex_UVTtiling": 50.0,
                    "MacroTex_UvTiling": 10.0,
                    "Print1Tiling": 0.0,
                },
                "static_switches": {"DoPill": True, "DoDetailNormal": True},
                "textures": {
                    "normalmap": "/Game/Fab/x/N.N",
                    "AO": "/Game/Fab/x/AO.AO",
                    "Masks": "/Game/Fab/x/M.M",
                    "CustomStitch": "/Game/Fab/x/S.S",
                    "detailTex_normal": "/Game/Fab/x/weave_n.weave_n",
                    "DetailTex_Variation": "/Game/Fab/x/var.var",
                    "Pill_n_map": "/Game/Fab/x/pill_n.pill_n",
                    "Pilling_A": "/Game/Fab/x/pill.pill",
                },
                "vectors": {},
            }
        },
        "textures": {
            f"/Game/Fab/x/{n}.{n}": {"file": f"{n}.png", "srgb": False}
            for n in ("N", "AO", "M", "S", "weave_n", "var", "pill_n", "pill")
        },
    }


def test_outfit_info_renames_material_and_scales_tiling():
    files = {s: f"T_AS_Test_{s}.png" for s in ("normalmap", "AO", "Masks", "CustomStitch")}
    info = outfit_info(template_info(), "AS_Test", "female", files, 1.5, {"DoPill": False})
    ((path, material),) = info["materials"].items()
    assert path.endswith("/MI_AS_Test.MI_AS_Test"), path
    assert path.startswith("/Game/Custom/"), path
    assert material["scalars"]["DetailTex_UVTtiling"] == pytest.approx(150.0)
    assert material["scalars"]["B_DetailTex_UVTtiling"] == pytest.approx(75.0)
    assert material["scalars"]["MacroTex_UvTiling"] == pytest.approx(15.0)
    assert material["scalars"]["Print1Tiling"] == 0.0
    assert material["static_switches"]["DoPill"] is False


def test_outfit_info_keeps_only_sampled_tiling_maps():
    files = {s: f"T_AS_Test_{s}.png" for s in ("normalmap", "AO", "Masks", "CustomStitch")}
    info = outfit_info(template_info(), "AS_Test", "female", files, 1.0, {"DoPill": False})
    listed = {entry["file"] for entry in info["textures"].values()}
    assert set(files.values()) <= listed
    assert "weave_n.png" in listed and "var.png" in listed
    assert "pill.png" not in listed and "pill_n.png" not in listed, "pilling is switched off"


def test_garment_maps_draw_seams_and_stay_flat_elsewhere():
    seam = np.array([[0.5, 0.1], [0.5, 0.9]])
    lines = GarmentLines(seams=[seam], edges=[], stitches=[seam + np.array([0.05, 0.0])])
    maps = garment_maps(lines, uv_metres=1.0, size=256)
    normal = np.asarray(maps["normalmap"])[..., :3].astype(int)
    assert abs(normal[128, 20] - [128, 128, 255]).max() <= 1, "flat away from the seam"
    assert abs(normal[128, 126:131, 0] - 128).max() > 5, "the seam bends the normal"
    occlusion = np.asarray(maps["AO"])[..., 0]
    assert occlusion[128, 128] < occlusion[128, 20]
    assert np.asarray(maps["CustomStitch"])[128, 138:144].max() > 0, "stitch at u = 0.55"
    masks = np.asarray(maps["Masks"])
    assert (masks[..., 1] == 0).all() and (masks[..., 2] == 0).all(), "one colour, material A"


def test_garment_maps_crease_raises_a_narrow_ridge():
    crease = np.array([[0.5, 0.1], [0.5, 0.9]])
    maps = garment_maps(GarmentLines(creases=[crease]), uv_metres=1.0, size=256)
    normal = np.asarray(maps["normalmap"])[..., 0].astype(int)
    # The red channel tilts toward +u on the left flank and -u on the right: a ridge.
    left, right = normal[128, 120:128].min(), normal[128, 127:136].max()
    assert left < 120 and right > 136, f"no ridge: left {left}, right {right}"
    assert abs(normal[128, 100] - 128) <= 1, "flat away from the crease"


def test_garment_maps_raised_patch_stands_out_with_a_shadow_round_it():
    loop = np.array([[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6]])
    # 5 pixels per millimetre: the shadow spreads a few pixels out.
    maps = garment_maps(GarmentLines(raised=[loop]), uv_metres=0.05, size=256)
    occlusion = np.asarray(maps["AO"])[..., 0].astype(int)
    assert occlusion[128, 128] == 255, "the patch itself is not shadowed"
    assert occlusion[128, 100] < 255, f"no shadow just outside: {occlusion[128, 100]}"
    normal = np.asarray(maps["normalmap"])[..., 0].astype(int)
    assert abs(normal[128, 128] - 128) <= 1, "flat on top of the patch"
    assert normal[128, 100:103].min() < 120, "its edge slopes"


def test_garment_maps_buttons_take_colour_two_and_gloss():
    maps = garment_maps(GarmentLines(buttons=[(0.5, 0.5, 0.04)]), uv_metres=1.0, size=256)
    masks = np.asarray(maps["Masks"])[..., 1]
    assert masks[128, 128] == 255 and masks[128, 20] == 0, "colour 2 on the button only"
    ao = np.asarray(maps["AO"])
    assert ao[128, 128, 1] < ao[128, 20, 1], "glossier than the cloth"
    assert ao[128, 141, 0] < ao[128, 20, 0], "a shadow round the rim"
    normal = np.asarray(maps["normalmap"])[..., :3].astype(int)
    hole = np.round(128 + 256 * 0.04 * 0.3 * np.array([np.sin(np.pi / 4), np.cos(np.pi / 4)]))
    y, x = int(hole[0]), int(hole[1])
    assert abs(normal[y - 2 : y + 3, x - 2 : x + 3, :2] - 128).max() > 5, "holes dent it"


ARCHIVE = archive_root()
UNIT = ARCHIVE / "raw" / "outfits" / "female" / "WI_AS_PencilSkirt"


@pytest.mark.skipif(not UNIT.is_dir(), reason="pencil skirt unit not built here")
def test_pencil_skirt_unit_reads_like_an_epic_unit():
    assert _is_unit(UNIT, "female")
    unit = OutfitUnit.load(UNIT, "female")
    assert list(unit.materials()) == ["MI_AS_PencilSkirt"]
    done = json.loads((UNIT / "done.json").read_text(encoding="utf-8"))
    for entry in done["files"]:
        data = (UNIT / entry["path"]).read_bytes()
        assert hashlib.sha256(data).hexdigest() == entry["sha256"], entry["path"]
    names = {Path(e["path"]).as_posix() for e in done["files"]}
    assert {"outfit.json", "OutfitBase_female_Outfits.glb"} <= names
