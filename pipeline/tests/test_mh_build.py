"""Incremental builds: stamps, skip logic and failure reporting."""

import json
from pathlib import Path

from asset_pipeline.mh.build import (
    Builder,
    _entry_files,
    fab_animations,
    with_compat,
    with_gender,
    with_socks,
    with_thumbnail,
)
from asset_pipeline.mh.convert import ConversionError
from asset_pipeline.mh.stamps import Stamps, fingerprint


def test_fingerprint_follows_file_contents(tmp_path: Path) -> None:
    done = tmp_path / "done.json"
    done.write_text("{}", encoding="utf-8")
    first = fingerprint("v1", done)
    assert fingerprint("v1", done) == first
    assert fingerprint("v2", done) != first
    done.write_text('{"files": 1}', encoding="utf-8")
    assert fingerprint("v1", done) != first
    assert fingerprint("v1", tmp_path / "missing.json") != first


def test_stamp_is_current_only_while_outputs_exist(tmp_path: Path) -> None:
    stamps = Stamps(tmp_path)
    output = tmp_path / "web" / "a.bin"
    output.parent.mkdir()
    output.write_bytes(b"1")
    stamps.record("faces/Ada", "abc", [output], {"face": {"id": "face.Ada"}})
    assert stamps.is_current("faces/Ada", "abc")
    assert not stamps.is_current("faces/Ada", "other")
    assert stamps.info("faces/Ada") == {"face": {"id": "face.Ada"}}
    output.unlink()
    assert not stamps.is_current("faces/Ada", "abc")


def test_builder_skips_current_assets_and_reports_failures(tmp_path: Path) -> None:
    logs: list[str] = []
    builder = Builder(tmp_path, log=logs.append)
    output = builder.web / "x.txt"
    calls = []

    def build() -> tuple[list[Path], dict, str]:
        calls.append(1)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text("x", encoding="utf-8")
        return [output], {"thing": 1}, "made"

    assert builder.run("things/x", "p1", build).status == "built"
    assert builder.run("things/x", "p1", build).status == "skipped"
    assert builder.run("things/x", "p2", build).status == "built"
    builder.force = True
    assert builder.run("things/x", "p2", build).status == "built"
    assert len(calls) == 3
    assert builder.records("things") == [{"thing": 1}]

    def broken() -> tuple[list[Path], dict, str]:
        raise ConversionError("source missing")

    outcome = builder.run("things/y", "p1", broken)
    assert outcome.status == "failed" and "source missing" in outcome.detail
    assert any("failed" in line for line in logs)


def test_fab_clip_lists_become_idle_animations(tmp_path: Path) -> None:
    folder = tmp_path / "animations" / "fab" / "crowd"
    folder.mkdir(parents=True)
    (folder / "a.glb").write_bytes(b"glb")
    (folder / "b.glb").write_bytes(b"glb")
    clips = [
        {"file": "a.glb", "standing": True, "calm": True},
        {"file": "b.glb", "standing": False, "calm": False},
        {"file": "missing.glb", "standing": True, "calm": True},
    ]
    (folder / "clips.json").write_text(json.dumps({"fps": 30, "clips": clips}), encoding="utf-8")
    entries = fab_animations(tmp_path)
    assert entries == [
        {
            "id": "anim.fab.crowd.a",
            "kind": "body",
            "file": "animations/fab/crowd/a.glb",
            "loop": True,
            "tags": ["idle", "standing", "calm"],
        },
        {
            "id": "anim.fab.crowd.b",
            "kind": "body",
            "file": "animations/fab/crowd/b.glb",
            "loop": True,
            "tags": ["idle"],
        },
    ]


def test_fab_clip_roles_lead_the_tags_and_unknown_roles_are_skipped(tmp_path: Path) -> None:
    folder = tmp_path / "animations" / "fab" / "crowd"
    folder.mkdir(parents=True)
    for name in ("talk", "listen", "idle", "legacy", "dance", "broken"):
        (folder / f"{name}.glb").write_bytes(b"glb")
    clips = [
        {"file": "talk.glb", "role": "talk", "standing": True, "calm": False},
        {"file": "listen.glb", "role": "listen", "standing": True, "calm": True},
        {"file": "idle.glb", "role": "idle", "standing": False, "calm": True},
        {"file": "legacy.glb", "standing": True, "calm": False},  # written before roles existed
        {"file": "dance.glb", "role": "dance", "standing": True, "calm": True},
        {"file": "broken.glb", "role": ["talk"], "standing": True, "calm": True},
    ]
    (folder / "clips.json").write_text(json.dumps({"fps": 30, "clips": clips}), encoding="utf-8")
    tags = {entry["id"]: entry["tags"] for entry in fab_animations(tmp_path)}
    assert tags == {
        "anim.fab.crowd.talk": ["talk", "standing"],
        "anim.fab.crowd.listen": ["listen", "standing", "calm"],
        "anim.fab.crowd.idle": ["idle", "calm"],
        "anim.fab.crowd.legacy": ["idle", "standing"],
    }, "unknown or malformed roles skip the clip, a missing role means idle"


def test_thumbnails_are_listed_exactly_when_the_file_exists(tmp_path: Path) -> None:
    (tmp_path / "faces" / "Ada").mkdir(parents=True)
    (tmp_path / "faces" / "Ada" / "thumbnail.webp").write_bytes(b"webp")
    face = {"id": "face.Ada", "head": "faces/Ada/head.glb"}
    assert with_thumbnail(face, "head", tmp_path)["thumbnail"] == "faces/Ada/thumbnail.webp"
    stale = {"id": "face.Bo", "head": "faces/Bo/head.glb", "thumbnail": "faces/Bo/thumbnail.webp"}
    assert "thumbnail" not in with_thumbnail(stale, "head", tmp_path)
    assert "thumbnail" not in face, "the build record is not modified"


def test_grooms_take_the_curated_gender_or_keep_their_own() -> None:
    pixie = {"id": "groom.hair.Hair_S_Pixie", "slot": "hair", "compat": "unisex"}
    beard = {"id": "groom.beard.Beard_M_Curly", "slot": "beard", "compat": "male"}
    assert with_compat(pixie)["compat"] == "female"
    assert with_compat(beard) == beard


def test_skin_outputs_include_the_nested_underwear_maps() -> None:
    entry = {
        "face": {
            "albedo": "skins/Ada/face_albedo.ktx2",
            "wrinkleMasks": ["skins/masks/m/wm1.ktx2"],
            "underwear": {"straps": "skins/Ada/face_underwear.ktx2"},
        },
        "body": {
            "albedo": "skins/Ada/body_albedo.ktx2",
            "underwear": {
                "mask": "skins/underwear/u/mask.ktx2",
                "albedo": "skins/underwear/u/albedo.ktx2",
                "normal": "skins/underwear/u/normal.ktx2",
            },
        },
        "makeupAlbedo": "skins/Ada/face_albedo_makeup.ktx2",
    }
    files = sorted(_entry_files(entry))
    assert files == [
        "skins/Ada/body_albedo.ktx2",
        "skins/Ada/face_albedo.ktx2",
        "skins/Ada/face_albedo_makeup.ktx2",
        "skins/Ada/face_underwear.ktx2",
        "skins/masks/m/wm1.ktx2",
        "skins/underwear/u/albedo.ktx2",
        "skins/underwear/u/mask.ktx2",
        "skins/underwear/u/normal.ktx2",
    ], f"unexpected skin outputs: {files}"


def test_skins_take_their_preset_gender(tmp_path: Path, monkeypatch) -> None:
    unit = tmp_path / "raw" / "characters" / "Omari"
    (unit / "dcc" / "Omari").mkdir(parents=True)
    (unit / "dcc" / "Omari" / "head.dna").write_bytes(b"")
    (unit / "done.json").write_text("{}", "utf-8")
    monkeypatch.setattr(
        "asset_pipeline.mh.build.preset_gender", lambda archive, name, dna: ("male", "test")
    )
    skin = {"id": "skin.Omari", "tone": 0.9}
    assert with_gender(skin, tmp_path) == {**skin, "gender": "male"}
    missing = {"id": "skin.Nobody", "tone": 0.1}
    assert with_gender(missing, tmp_path) == missing, "a skin without sources keeps its entry"


def test_bodies_carry_their_sock_toes_file_when_built() -> None:
    records = [
        {"body": {"gender": "female", "glb": "bodies/female/body.glb"}},
        {"body_socks": {"gender": "female", "socks": "bodies/female/socks.bin"}},
        {"body": {"gender": "male", "glb": "bodies/male/body.glb"}},
    ]
    female, male = with_socks(records)
    assert female == {
        "gender": "female",
        "glb": "bodies/female/body.glb",
        "socks": "bodies/female/socks.bin",
    }
    assert "socks" not in male
