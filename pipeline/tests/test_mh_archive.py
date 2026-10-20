import json
from pathlib import Path

import pytest
from mh_export.archive import (
    DONE_FILE,
    Archive,
    JobLog,
    SkipList,
    Unit,
    drop_shared_files,
    is_done,
    run_units,
    safe_name,
    verify_done,
    write_done,
)


def _write(directory: Path, rel: str, data: bytes) -> None:
    path = directory / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def _events(log: JobLog) -> list[dict]:
    return [json.loads(line) for line in log.path.read_text().splitlines()]


def test_safe_name_keeps_portable_characters():
    assert safe_name("Hair_S_UpdoBraids") == "Hair_S_UpdoBraids"
    assert safe_name("WI Default/Garment:01") == "WI_Default_Garment_01"


def test_safe_name_rejects_names_with_nothing_usable():
    with pytest.raises(ValueError):
        safe_name("///")


def test_unit_dir_sanitises_every_part(tmp_path):
    archive = Archive(tmp_path)
    assert archive.unit_dir("grooms", "Hair", "Bob Curly") == tmp_path / "raw/grooms/Hair/Bob_Curly"


def test_done_marker_lists_files_and_detects_size_changes(tmp_path):
    _write(tmp_path, "dcc/head.dna", b"head")
    _write(tmp_path, "dcc/textures/albedo.png", b"pixels")
    done = write_done(tmp_path, {"preset": "Ada"})
    assert done["file_count"] == 2
    assert done["total_bytes"] == 10
    assert [record["path"] for record in done["files"]] == [
        "dcc/head.dna",
        "dcc/textures/albedo.png",
    ]
    assert is_done(tmp_path)

    (tmp_path / "dcc/head.dna").write_bytes(b"truncated head")
    assert not is_done(tmp_path)


def test_verify_done_catches_same_size_corruption(tmp_path):
    _write(tmp_path, "a.bin", b"1234")
    write_done(tmp_path, {})
    (tmp_path / "a.bin").write_bytes(b"4321")
    assert is_done(tmp_path)
    assert verify_done(tmp_path) == [f"{tmp_path / 'a.bin'}: hash mismatch"]


def test_write_done_refuses_empty_exports(tmp_path):
    with pytest.raises(RuntimeError):
        write_done(tmp_path, {})


def test_run_units_exports_into_partial_dir_then_renames(tmp_path):
    archive = Archive(tmp_path)
    log = JobLog(archive.logs, "characters")
    target = archive.unit_dir("characters", "Ada")
    seen: list[Path] = []

    def export(work: Path) -> dict:
        seen.append(work)
        _write(work, "head.dna", b"dna")
        return {"preset": "Ada"}

    summary = run_units([Unit("Ada", target, export)], log)
    assert summary.done == ["Ada"]
    assert seen == [target.with_name("Ada.partial")]
    assert not seen[0].exists()
    assert json.loads((target / DONE_FILE).read_text())["meta"] == {"preset": "Ada"}
    assert [event["status"] for event in _events(log)] == ["started", "done", "finished"]


def test_run_units_skips_done_units_and_survives_failures(tmp_path):
    archive = Archive(tmp_path)
    log = JobLog(archive.logs, "characters")
    done_dir = archive.unit_dir("characters", "Ada")
    _write(done_dir, "head.dna", b"dna")
    write_done(done_dir, {})
    stale = archive.unit_dir("characters", "Bo").with_name("Bo.partial")
    _write(stale, "leftover.png", b"old")

    def broken(work: Path) -> dict:
        raise RuntimeError("cloud request timed out")

    def ok(work: Path) -> dict:
        assert not (work / "leftover.png").exists()
        _write(work, "head.dna", b"dna")
        return {}

    units = [
        Unit("Ada", done_dir, broken),
        Unit("Cy", archive.unit_dir("characters", "Cy"), broken),
        Unit("Bo", archive.unit_dir("characters", "Bo"), ok),
    ]
    summary = run_units(units, log)
    assert summary.skipped == ["Ada"]
    assert summary.failed == {"Cy": "RuntimeError: cloud request timed out"}
    assert summary.done == ["Bo"]
    assert not archive.unit_dir("characters", "Cy").exists()
    failed = [event for event in _events(log) if event["status"] == "failed"]
    assert failed[0]["unit"] == "Cy"


def test_run_units_force_reexports_done_units(tmp_path):
    archive = Archive(tmp_path)
    target = archive.unit_dir("characters", "Ada")
    _write(target, "old.dna", b"old")
    write_done(target, {})

    def export(work: Path) -> dict:
        _write(work, "new.dna", b"new")
        return {}

    run_units([Unit("Ada", target, export)], JobLog(archive.logs, "x"), force=True)
    assert (target / "new.dna").exists()
    assert not (target / "old.dna").exists()


def test_run_units_rereads_skip_list_before_every_unit(tmp_path):
    archive = Archive(tmp_path)
    archive.root.mkdir(exist_ok=True)
    archive.skip_file.write_text('["Bo"]', encoding="utf-8")
    exported: list[str] = []

    def export_and_skip_next(work: Path) -> dict:
        exported.append(work.name)
        archive.skip_file.write_text('["Bo", "Cy"]', encoding="utf-8")
        _write(work, "head.dna", b"dna")
        return {}

    units = [
        Unit(name, archive.unit_dir("characters", name), export_and_skip_next)
        for name in ("Ada", "Bo", "Cy")
    ]
    summary = run_units(units, JobLog(archive.logs, "x"), skip=SkipList(archive.skip_file))
    assert summary.done == ["Ada"]
    assert summary.excluded == ["Bo", "Cy"]
    assert exported == ["Ada.partial"]


def test_skip_list_keeps_last_good_names_when_file_is_mid_edit(tmp_path):
    path = tmp_path / "skip.json"
    path.write_text('["Ada"]', encoding="utf-8")
    skip = SkipList(path)
    assert skip.names() == {"Ada"}
    path.write_text('["Ada", "B', encoding="utf-8")
    assert skip.names() == {"Ada"}


def test_drop_shared_files_keeps_only_what_the_variant_changed(tmp_path):
    clean, baked = tmp_path / "dcc", tmp_path / "dcc_makeup"
    _write(clean, "Maps/head_albedo.png", b"no makeup")
    _write(clean, "Maps/head_normal.png", b"normal")
    _write(clean, "head.dna", b"dna")
    _write(baked, "Maps/head_albedo.png", b"with lipstick")
    _write(baked, "Maps/head_normal.png", b"normal")
    _write(baked, "head.dna", b"dna")
    assert drop_shared_files(clean, baked) == 2
    assert [p.relative_to(baked).as_posix() for p in baked.rglob("*")] == [
        "Maps",
        "Maps/head_albedo.png",
    ]


def test_run_units_limit_defers_the_rest(tmp_path):
    archive = Archive(tmp_path)
    log = JobLog(archive.logs, "limit")
    calls: list[str] = []

    def make(name: str) -> Unit:
        def export(work: Path) -> dict[str, str]:
            calls.append(name)
            (work / "a.txt").write_text(name)
            return {}

        return Unit(name, archive.unit_dir("u", name), export)

    summary = run_units([make("one"), make("two"), make("three")], log, limit=1)
    assert summary.done == ["one"], f"Expected only the first unit, got {summary.done}"
    assert summary.deferred == ["two", "three"], f"Unexpected deferred list {summary.deferred}"
    again = run_units([make("one"), make("two"), make("three")], log, limit=1)
    assert again.skipped == ["one"] and again.done == ["two"], f"Resume broke: {again.as_dict()}"
    assert calls == ["one", "two"]
