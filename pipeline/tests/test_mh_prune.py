"""Pruning curated-out assets: what goes, what stays shared, and the converter skip."""

import argparse
import json
import shutil
from pathlib import Path

import pytest

from asset_pipeline.mh.build import Builder, read_pruned
from asset_pipeline.mh.prune import PruneError, _check_target, apply_plan, plan_prune
from asset_pipeline.mh.prune import run as prune_run
from asset_pipeline.mh.stamps import Stamps


def _write(path: Path, text: str = "x") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def _archive(root: Path) -> Path:
    """Presets Ada (reference) and Bo, one Fab groom, two outfits from one Fab package."""
    stamps = Stamps(root)
    for preset in ("Ada", "Bo"):
        _write(root / "raw" / "characters" / preset / "done.json", "{}")
        head = _write(root / "web" / "faces" / preset / "head.glb")
        _write(root / "web" / "faces" / preset / "thumbnail.webp")
        stamps.record(
            f"faces/{preset}", "p", [head], {"face": {"id": f"face.{preset}", "head": "x"}}
        )
        albedo = _write(root / "web" / "skins" / preset / "face_albedo.ktx2")
        mask = _write(root / "web" / "skins" / "masks" / "shared" / "wm1.ktx2")
        stamps.record(f"skins/{preset}", "p", [albedo, mask], {"skin": {"id": f"skin.{preset}"}})
        color = _write(root / "web" / "irises" / preset / "color.ktx2")
        stamps.record(f"irises/{preset}", "p", [color], {"iris": {"id": f"iris.{preset}"}})

    groom_unit = root / "raw" / "grooms" / "Hair" / "Hair_L_Pony"
    _write(groom_unit / "done.json", "{}")
    _write(groom_unit / "cards.json", '{"asset": "/Game/Fab/hair_pony/Hair_L_Pony.Hair_L_Pony"}')
    cards = _write(root / "web" / "grooms" / "hair" / "Hair_L_Pony" / "cards.glb")
    stamps.record(
        "grooms/hair/Hair_L_Pony",
        "p",
        [cards],
        {"groom": {"id": "groom.hair.Hair_L_Pony", "glb": "grooms/hair/Hair_L_Pony/cards.glb"}},
    )
    _write(root / "fab" / "hair_pony.mhpkg")
    _write(root / "raw" / "fab_import" / "hair_pony" / "done.json", "{}")

    for name in ("Jeans", "Jeansakn"):
        for gender in ("female", "male"):
            unit = root / "raw" / "outfits" / gender / f"WI_{name}"
            _write(unit / "done.json", "{}")
            _write(unit / "outfit.json", json.dumps({"item": f"/Game/Fab/oa_jeans/{name}.x"}))
            _write(unit / f"OutfitBase_{gender}_Outfits.glb")
            glb = _write(root / "web" / "outfits" / name / f"{gender}.glb")
            shared = _write(root / "web" / "outfits" / "shared" / "denim.ktx2")
            stamps.record(
                f"outfits/{name}/{gender}",
                "p",
                [glb, shared],
                {"outfit": {"id": f"outfit.{name}", "name": name, "gender": gender}},
            )
    _write(root / "fab" / "oa_jeans.mhpkg")

    manifest = {
        "faces": [
            {"id": f"face.{p}", "head": f"faces/{p}/head.glb", "defaultIris": f"iris.{p}"}
            for p in ("Ada", "Bo")
        ],
        "animations": [
            {"id": "anim.fab.crowd.c01", "file": "animations/fab/crowd/c01.glb"},
            {"id": "anim.fab.crowd.c02", "file": "animations/fab/crowd/c02.glb"},
        ],
    }
    _write(root / "web" / "animations" / "fab" / "crowd" / "c01.glb")
    _write(root / "web" / "animations" / "fab" / "crowd" / "c02.glb")
    _write(root / "web" / "manifest.json", json.dumps(manifest))
    return root


def test_prunes_a_preset_only_when_face_and_skin_go(tmp_path: Path) -> None:
    archive = _archive(tmp_path)
    face_only = plan_prune(archive, {"face.Bo"})
    assert face_only.ids == ("face.Bo",)
    assert face_only.folders == ("web/faces/Bo",)
    assert face_only.sources == ()
    assert dict(face_only.kept)["raw/characters/Bo"] == "iris.Bo, skin.Bo still in the catalogue"

    both = plan_prune(archive, {"face.Bo", "skin.Bo"})
    assert both.ids == ("face.Bo", "iris.Bo", "skin.Bo")
    assert both.sources == ("raw/characters/Bo",)
    assert "web/irises/Bo" in both.folders
    # Ada's skin still uses the shared wrinkle masks.
    assert not any("masks" in p for p in both.paths)


def test_keeps_the_reference_head_export(tmp_path: Path) -> None:
    plan = plan_prune(_archive(tmp_path), {"face.Ada", "skin.Ada"})
    assert plan.sources == ()
    assert dict(plan.kept)["raw/characters/Ada"] == "reference head for grooms and face clips"


def test_fab_package_goes_with_its_last_item(tmp_path: Path) -> None:
    archive = _archive(tmp_path)
    one = plan_prune(archive, {"outfit.Jeans"})
    assert one.sources == ("raw/outfits/female/WI_Jeans", "raw/outfits/male/WI_Jeans")
    assert one.packages == ()
    assert "fab/oa_jeans" in dict(one.kept)
    assert "web/outfits/shared/denim.ktx2" not in one.files

    both = plan_prune(archive, {"outfit.Jeans", "outfit.Jeansakn"})
    assert both.packages == ("fab/oa_jeans.mhpkg",)
    assert "web/outfits/shared/denim.ktx2" in both.files

    groom = plan_prune(archive, {"groom.hair.Hair_L_Pony"})
    assert groom.sources == ("raw/grooms/Hair/Hair_L_Pony",)
    assert groom.packages == ("fab/hair_pony.mhpkg", "raw/fab_import/hair_pony")


def test_apply_deletes_records_and_hides_from_the_converter(tmp_path: Path) -> None:
    archive = _archive(tmp_path)
    plan = plan_prune(archive, {"groom.hair.Hair_L_Pony", "anim.fab.crowd.c02", "face.Nobody"})
    assert plan.unknown == ("face.Nobody",)
    assert plan.files == ("web/animations/fab/crowd/c02.glb",)
    assert apply_plan(plan) > 0
    assert not (archive / "raw" / "grooms" / "Hair" / "Hair_L_Pony").exists()
    assert not (archive / "fab" / "hair_pony.mhpkg").exists()
    assert not (archive / "web" / "animations" / "fab" / "crowd" / "c02.glb").exists()
    assert (archive / "web" / "animations" / "fab" / "crowd" / "c01.glb").is_file()
    assert Stamps(archive).read("grooms/hair/Hair_L_Pony") is None
    assert read_pruned(archive) == {"groom.hair.Hair_L_Pony", "anim.fab.crowd.c02"}

    logs: list[str] = []
    pruned = Builder(archive, log=logs.append)
    _write(archive / "raw" / "pruned.json", json.dumps({"ids": ["face.Bo"]}))
    assert pruned.head("Bo") is None
    assert logs[-1] == "skip    faces/Bo: pruned"
    assert all(info["face"]["id"] != "face.Bo" for info in pruned.records("faces"))


def test_refuses_paths_outside_or_at_the_top_of_the_archive(tmp_path: Path) -> None:
    for bad in ("raw", "../elsewhere/x", "web/../../x"):
        with pytest.raises(PruneError):
            _check_target(tmp_path, bad)
    _check_target(tmp_path, "raw/characters/Bo")


def test_lists_fab_packages_nothing_came_from(tmp_path: Path) -> None:
    archive = _archive(tmp_path)
    _write(archive / "fab" / "vampire.mhpkg")
    plan = plan_prune(archive, set())
    assert plan.unused == ("fab/vampire.mhpkg",)
    assert plan.packages == ()
    assert plan_prune(archive, set(), unused=True).packages == ("fab/vampire.mhpkg",)


def test_no_package_counts_as_unused_while_an_export_unit_is_missing(tmp_path: Path) -> None:
    archive = _archive(tmp_path)
    _write(archive / "fab" / "vampire.mhpkg")
    # An export in progress moves the unit aside; its package must not look unused.
    shutil.rmtree(archive / "raw" / "outfits" / "female" / "WI_Jeans")
    plan = plan_prune(archive, set(), unused=True)
    assert plan.unused == ()
    assert plan.packages == ()
    assert plan.unresolved == ("outfit.Jeans",)


def test_apply_needs_the_digest_of_the_reviewed_plan(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    archive = _archive(tmp_path)
    _write(archive / "web" / "curation.json", json.dumps({"hidden": ["anim.fab.crowd.c02"]}))
    clip = archive / "web" / "animations" / "fab" / "crowd" / "c02.glb"
    # The fake catalogue is too thin for a real manifest; the rebuild is not under test.
    monkeypatch.setattr(Builder, "manifest", lambda self: archive / "web" / "manifest.json")

    def run(**options: object) -> int:
        defaults = {"archive": archive, "apply": False, "plan": None}
        defaults.update(unused_packages=False, verbose=False)
        return prune_run(argparse.Namespace(**{**defaults, **options}))

    assert run() == 0
    digest = plan_prune(archive, {"anim.fab.crowd.c02"}).digest
    assert f"--apply --plan {digest}" in capsys.readouterr().out
    assert run(apply=True) == 2
    assert run(apply=True, plan="0000000000") == 2
    assert clip.is_file()
    assert run(apply=True, plan=digest) == 0
    assert not clip.exists()
