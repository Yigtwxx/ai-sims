import json
from pathlib import Path

import pytest

from asset_pipeline.manifest import Sources, build_manifest, write_manifest


def _write_report(parts_dir: Path, source: str, categories: list[str]) -> None:
    stem = Path(source).stem
    report = {
        "source": source,
        "parts": [
            {"category": c, "file": f"{stem}__{c}.vrm", "bytes": 100, "materials": []}
            for c in categories
        ],
    }
    (parts_dir / f"{stem}.parts.json").write_text(json.dumps(report))


@pytest.fixture
def sources() -> Sources:
    return Sources(entries={"Donor_F": {"gender": "female", "label": "Donor F"}})


def test_build_manifest_splits_bases_from_parts(tmp_path, sources):
    _write_report(tmp_path, "Donor_F.vrm", ["base", "top", "hair"])
    manifest = build_manifest(tmp_path, sources)
    assert [b["id"] for b in manifest["bases"]] == ["Donor_F__base"], "base becomes a face option"
    assert [p["id"] for p in manifest["parts"]] == ["Donor_F__hair", "Donor_F__top"], "sorted parts"


def test_build_manifest_carries_source_metadata(tmp_path, sources):
    _write_report(tmp_path, "Donor_F.vrm", ["shoes"])
    [part] = build_manifest(tmp_path, sources)["parts"]
    assert part["gender"] == "female", f"expected female, got {part['gender']}"
    assert part["label"] == "Donor F", f"expected label, got {part['label']}"
    assert part["url"] == "/assets/vrm/parts/Donor_F__shoes.vrm", f"bad url {part['url']}"


def test_build_manifest_unknown_source_defaults_to_unisex(tmp_path, sources):
    _write_report(tmp_path, "Mystery_Model.vrm", ["shoes"])
    [part] = build_manifest(tmp_path, sources)["parts"]
    assert part["gender"] == "unisex", f"expected unisex, got {part['gender']}"
    assert part["label"] == "Mystery Model", f"expected derived label, got {part['label']}"


def test_sources_invalid_gender_raises_value_error():
    with pytest.raises(ValueError):
        Sources(entries={"X": {"gender": "robot"}}).gender("X")


def test_write_manifest_writes_utf8_json(tmp_path):
    _write_report(tmp_path, "Ayşe.vrm", ["base"])
    sources_path = tmp_path / "sources.json"
    sources_path.write_text(
        json.dumps({"sources": {"Ayşe": {"gender": "female", "label": "Ayşe"}}})
    )
    out = tmp_path / "manifest.json"
    write_manifest(tmp_path, sources_path, out)
    assert "Ayşe" in out.read_text(encoding="utf-8"), "non-ASCII labels kept readable"
