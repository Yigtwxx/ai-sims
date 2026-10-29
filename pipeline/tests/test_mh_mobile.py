"""Phone-sized KTX2 copies: level cropping, the incremental writer and its index."""

import json
import os
import struct
import subprocess
from pathlib import Path

import numpy as np
import pytest

from asset_pipeline.mh import ktx
from asset_pipeline.mh.mobile import (
    INDEX_FILE,
    SUFFIX,
    Ktx2LayoutError,
    crop_levels,
    read_layout,
    variant_path,
    write_mobile_textures,
)


def fake_ktx2(width: int, height: int, levels: int, *, faces: int = 1, scheme: int = 2) -> bytes:
    """A KTX2 laid out like `ktx create` writes it (index, DFD, KVD, smallest level first);
    level i's payload is `i + 1` repeated, longer for larger levels."""
    dfd = b"D" * 44
    kvd = struct.pack("<I", 11) + b"KTXwriter\0x" + b"\0"  # one key, padded to 4
    payloads = [bytes([i + 1]) * (8 * (levels - i)) for i in range(levels)]
    dfd_offset = 80 + 24 * levels
    kvd_offset = dfd_offset + len(dfd)
    position = kvd_offset + len(kvd)
    offsets = [0] * levels
    for i in reversed(range(levels)):
        offsets[i] = position
        position += len(payloads[i])
    header = b"\xabKTX 20\xbb\r\n\x1a\n" + struct.pack(
        "<9I", 0, 1, width, height, 0, 0, faces, levels, scheme
    )
    header += struct.pack("<4I2Q", dfd_offset, len(dfd), kvd_offset, len(kvd), 0, 0)
    index = b"".join(struct.pack("<3Q", offsets[i], len(payloads[i]), 64) for i in range(levels))
    return header + index + dfd + kvd + b"".join(payloads[i] for i in reversed(range(levels)))


def level_bytes(data: bytes) -> list[bytes]:
    layout = read_layout(data)
    return [data[level.offset : level.offset + level.length] for level in layout.levels]


def test_crop_drops_the_levels_above_the_cap() -> None:
    source = fake_ktx2(4096, 2048, 13)
    cropped = crop_levels(source, 1024)
    assert cropped is not None
    layout = read_layout(cropped)
    assert (layout.width, layout.height) == (1024, 512)
    assert len(layout.levels) == 11
    assert level_bytes(cropped) == level_bytes(source)[2:]
    # Metadata is carried over unchanged and the file ends with its largest level.
    assert cropped[layout.dfd[0] : layout.dfd[0] + 44] == b"D" * 44
    assert b"KTXwriter" in cropped[layout.kvd[0] : layout.kvd[0] + layout.kvd[1]]
    assert layout.levels[0].offset + layout.levels[0].length == len(cropped)


def test_crop_needs_only_the_kept_levels() -> None:
    source = fake_ktx2(2048, 2048, 12)
    layout = read_layout(source)
    prefix = source[: layout.needed_bytes(1)]
    assert len(prefix) < len(source)
    assert crop_levels(prefix, 1024) == crop_levels(source, 1024)
    with pytest.raises(Ktx2LayoutError):
        crop_levels(prefix[:-1], 1024)


def test_small_or_mipless_textures_are_left_alone() -> None:
    assert crop_levels(fake_ktx2(1024, 1024, 11), 1024) is None
    assert crop_levels(fake_ktx2(2048, 2048, 1), 1024) is None


def test_unsupported_layouts_are_refused() -> None:
    with pytest.raises(Ktx2LayoutError):
        crop_levels(fake_ktx2(2048, 2048, 12, faces=6), 1024)
    with pytest.raises(Ktx2LayoutError):
        crop_levels(fake_ktx2(2048, 2048, 12, scheme=1), 1024)
    with pytest.raises(Ktx2LayoutError):
        crop_levels(b"not a texture" * 10, 1024)


def test_writer_keeps_copies_and_index_in_step(tmp_path: Path) -> None:
    big = tmp_path / "skins" / "Ada" / "face_albedo.ktx2"
    small = tmp_path / "irises" / "Ada" / "color.ktx2"
    odd = tmp_path / "lighting" / "cube.ktx2"
    for path, data in (
        (big, fake_ktx2(4096, 4096, 13)),
        (small, fake_ktx2(512, 512, 10)),
        (odd, fake_ktx2(2048, 2048, 12, faces=6)),
    ):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    orphan = tmp_path / "skins" / "Gone" / f"face_normal{SUFFIX}"
    orphan.parent.mkdir(parents=True)
    orphan.write_bytes(b"left over")
    stale = variant_path(small)
    stale.write_bytes(b"from when it was large")

    report = write_mobile_textures(tmp_path, 1024)
    assert (report.written, report.current, report.removed, report.skipped) == (1, 0, 2, 1)
    assert not orphan.exists() and not stale.exists()
    copy = variant_path(big).read_bytes()
    assert level_bytes(copy) == level_bytes(big.read_bytes())[2:]
    index = json.loads((tmp_path / INDEX_FILE).read_text(encoding="utf-8"))
    assert index == {
        "version": 1,
        "maxSize": 1024,
        "suffix": SUFFIX,
        "files": ["skins/Ada/face_albedo.ktx2"],
    }

    written_at = variant_path(big).stat().st_mtime_ns
    again = write_mobile_textures(tmp_path, 1024)
    assert (again.written, again.current) == (0, 1)
    assert variant_path(big).stat().st_mtime_ns == written_at

    # A re-encoded source (newer, different levels) replaces its copy.
    big.write_bytes(fake_ktx2(4096, 2048, 13))
    os.utime(big, ns=(written_at + 10**9, written_at + 10**9))
    assert write_mobile_textures(tmp_path, 1024).written == 1
    assert read_layout(variant_path(big).read_bytes()).height == 512


@pytest.mark.skipif(not ktx.is_available(), reason="KTX-Software not installed")
def test_real_ktx2_copy_validates(tmp_path: Path) -> None:
    rows, cols = np.mgrid[0:128, 0:256]
    image = np.stack([cols % 256, rows * 2, (cols + rows) % 256], axis=-1).astype(np.uint8)
    source = tmp_path / "map.ktx2"
    ktx.encode_ktx2(image, source, ktx.Ktx2Settings(transfer="srgb", rdo=None))
    cropped = crop_levels(source.read_bytes(), 64)
    assert cropped is not None
    layout = read_layout(cropped)
    assert (layout.width, layout.height) == (64, 32)
    assert level_bytes(cropped) == level_bytes(source.read_bytes())[2:]
    copy = tmp_path / "map.small.ktx2"
    copy.write_bytes(cropped)
    result = subprocess.run(
        [str(ktx.ktx_executable()), "validate", str(copy)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
