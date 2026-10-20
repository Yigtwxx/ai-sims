import zipfile
from pathlib import Path

import pytest

from asset_pipeline.packs import Pack, install, safe_extract


def _make_zip(path: Path, entries: dict[str, str]) -> Path:
    with zipfile.ZipFile(path, "w") as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    return path


def test_safe_extract_valid_archive_writes_files(tmp_path):
    archive_path = _make_zip(tmp_path / "ok.zip", {"targets/a.target": "x"})
    dest = tmp_path / "data"
    dest.mkdir()
    with zipfile.ZipFile(archive_path) as archive:
        safe_extract(archive, dest)
    assert (dest / "targets/a.target").read_text() == "x", "expected file to be extracted"


def test_safe_extract_path_traversal_raises_value_error(tmp_path):
    archive_path = _make_zip(tmp_path / "evil.zip", {"../escape.txt": "x"})
    dest = tmp_path / "data"
    dest.mkdir()
    with zipfile.ZipFile(archive_path) as archive, pytest.raises(ValueError):
        safe_extract(archive, dest)
    assert not (tmp_path / "escape.txt").exists(), "traversal entry must not be written"


def test_install_cached_pack_is_idempotent(tmp_path):
    cache = tmp_path / "cache"
    cache.mkdir()
    _make_zip(cache / "demo.zip", {"skins/s.mhmat": "m"})
    data = tmp_path / "data"
    pack = Pack("demo", "https://example.invalid/demo.zip")

    assert install(pack, cache, data) is True, "first install should extract"
    assert (data / "skins/s.mhmat").exists(), "pack content should be extracted"
    assert install(pack, cache, data) is False, "second install should be skipped"
