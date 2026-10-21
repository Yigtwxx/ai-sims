"""Manifest v2: assembly from build records, contract checks, and the web's zod schema."""

import json
import shutil
from pathlib import Path

import pytest

from asset_pipeline.mh.manifest import (
    CHECKER,
    SCHEMA,
    ManifestError,
    assemble,
    validate,
    validate_with_zod,
    write_manifest,
)


def _skin(name: str, tone: float) -> dict:
    return {
        "id": f"skin.{name}",
        "label": name,
        "tone": tone,
        "swatch": "#aa8877",
        "face": {
            "albedo": f"skins/{name}/face_albedo.ktx2",
            "normal": f"skins/{name}/face_normal.ktx2",
            "wrinkleColor": [f"skins/{name}/face_cm{i}.ktx2" for i in (1, 2, 3)],
            "wrinkleNormal": [f"skins/{name}/face_wm{i}.ktx2" for i in (1, 2, 3)],
            "wrinkleMasks": ["skins/masks/x/head_wm1_msk_01.ktx2"],
        },
        "body": {
            "albedo": f"skins/{name}/body_albedo.ktx2",
            "normal": f"skins/{name}/body_normal.ktx2",
        },
        "stats": {"bytes": {}},
    }


def _face(name: str, gender: str | None = "female") -> dict:
    return {"id": f"face.{name}", "label": name, "gender": gender, "head": f"faces/{name}/head.glb"}


def _sample() -> dict:
    return assemble(
        faces=[_face("Ada"), _face("Bruce", "male"), _face("Nobody", None)],
        skins=[_skin("Ada", 0.9), _skin("Aera", 0.3)],
        irises=[
            {
                "id": "iris.Ada",
                "label": "Ada",
                "color": "irises/Ada/color.ktx2",
                "swatch": "#593600",
            }
        ],
        bodies=[
            {
                "gender": "female",
                "glb": "bodies/female/body.glb",
                "sliders": [{"id": "height", "min": -1.0, "max": 1.0, "default": 0.0}],
                "presets": {"average": {"height": 0.0}},
            }
        ],
        animations=[
            {
                "id": "anim.idle.body",
                "kind": "body",
                "file": "animations/idle_body.glb",
                "loop": True,
                "tags": ["idle"],
            }
        ],
        lighting=[
            {
                "id": "light.tungsten",
                "label": "Tungsten",
                "file": "lighting/tungsten.json",
                "order": 2,
            },
            {"id": "light.studio", "label": "Studio", "file": "lighting/studio.json", "order": 0},
        ],
        outfits=[
            {
                "id": "outfit.OA_Jeans",
                "category": "bottom",
                "label": {"tr": "Kot pantolon", "en": "Jeans"},
                "compat": "unisex",
                "files": {
                    "female": "outfits/OA_Jeans/female.glb",
                    "male": "outfits/OA_Jeans/male.glb",
                },
                "params": [{"name": "diffuse_color_1", "type": "color", "default": "#101010"}],
                "tintPresets": [
                    {
                        "id": "default",
                        "label": {"tr": "Orijinal", "en": "Original"},
                        "values": {"diffuse_color_1": "#101010"},
                    }
                ],
                "hidesBodyRegions": ["thighs"],
            },
            {
                "id": "outfit.OA_Boots",
                "category": "shoes",
                "label": "Boots",
                "files": {"female": "outfits/OA_Boots/female.glb"},
                "hidesBodyRegions": [],
            },
        ],
        face_tones={"Bruce": 0.35},
        face_maps_from={"Bruce": "Ada"},
    )


def test_assemble_links_faces_to_skins_and_sorts() -> None:
    manifest = _sample()
    assert [s["id"] for s in manifest["skins"]] == ["skin.Aera", "skin.Ada"], "sorted by tone"
    assert all("stats" not in s for s in manifest["skins"])
    faces = {f["id"]: f for f in manifest["faces"]}
    assert set(faces) == {"face.Ada", "face.Bruce"}, "faces without a gender are left out"
    assert (
        faces["face.Ada"]["defaultSkin"] == "skin.Ada"
        and faces["face.Ada"]["defaultIris"] == "iris.Ada"
    )
    assert faces["face.Bruce"]["defaultSkin"] == "skin.Aera", "closest tone stands in"
    assert faces["face.Bruce"]["defaultIris"] == "iris.Ada", "no iris.Aera: the maps' preset"
    assert [o["id"] for o in manifest["outfits"]] == ["outfit.OA_Jeans", "outfit.OA_Boots"]
    assert [entry["id"] for entry in manifest["lighting"]] == ["light.studio", "light.tungsten"]
    assert validate(manifest) == []


def test_validate_reports_contract_breaks() -> None:
    manifest = _sample()
    manifest["skins"][0]["tone"] = 1.5
    manifest["skins"][0]["face"]["wrinkleNormal"].append("extra.ktx2")
    manifest["faces"][0]["defaultSkin"] = "skin.missing"
    manifest["animations"].append(dict(manifest["animations"][0]))
    manifest["outfits"][0]["category"] = "hat"
    manifest["outfits"][1]["files"] = {"robot": "x.glb"}
    problems = " | ".join(validate(manifest))
    for fragment in (
        "tone outside",
        "wrinkleNormal holds at most 3",
        "is not a skin",
        "used by animations",
        "outfit outfit.OA_Jeans: category",
        "files must map female/male",
    ):
        assert fragment in problems


def test_write_manifest_refuses_missing_files(tmp_path: Path) -> None:
    with pytest.raises(ManifestError):
        write_manifest(_sample(), tmp_path / "manifest.json", tmp_path)


def test_write_manifest_drops_internal_fields(tmp_path: Path) -> None:
    manifest = _sample()
    for path in {
        value
        for section in ("faces", "skins", "irises", "bodies", "animations", "lighting", "outfits")
        for item in manifest[section]
        for value in _files(item)
    }:
        (tmp_path / path).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / path).write_bytes(b"x")
    write_manifest(manifest, tmp_path / "manifest.json", tmp_path)
    written = json.loads((tmp_path / "manifest.json").read_text(encoding="utf-8"))
    assert all("order" not in entry for entry in written["lighting"])


def _files(item: dict) -> list[str]:
    out = []
    for key, value in item.items():
        if key in {
            "id",
            "label",
            "gender",
            "kind",
            "tags",
            "loop",
            "swatch",
            "defaultSkin",
            "defaultIris",
            "sliders",
            "presets",
            "tone",
            "order",
            "slot",
            "compat",
            "params",
            "category",
            "tintPresets",
            "hidesBodyRegions",
        }:
            continue
        if isinstance(value, str):
            out.append(value)
        elif isinstance(value, dict):
            out += _files(value)
        elif isinstance(value, list):
            out += [v for v in value if isinstance(v, str)]
    return out


@pytest.mark.skipif(
    shutil.which("node") is None
    or not SCHEMA.is_file()
    or not CHECKER.is_file()
    or not (SCHEMA.parents[3] / "node_modules" / "zod").exists(),
    reason="node or the web app's dependencies are not installed",
)
def test_assembled_manifest_passes_the_web_zod_schema(tmp_path: Path) -> None:
    path = tmp_path / "manifest.json"
    manifest = _sample()
    for entry in manifest["lighting"]:
        entry.pop("order")
    path.write_text(json.dumps(manifest), encoding="utf-8")
    assert validate_with_zod(path) is None
    manifest["faces"][0]["gender"] = "other"
    path.write_text(json.dumps(manifest), encoding="utf-8")
    assert validate_with_zod(path) is not None
