"""Download and install MakeHuman/MPFB asset packs into MPFB's user data dir."""

import os
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path

# files.makehumancommunity.org is ~70x faster than the files2 mirror.
_MIRROR = "https://files.makehumancommunity.org"

_DEFAULT_MPFB_DATA = (
    Path.home() / "Library/Application Support/Blender/5.2/extensions/.user/blender_org/mpfb/data"
)


@dataclass(frozen=True)
class Pack:
    name: str
    url: str


PACKS: tuple[Pack, ...] = (
    Pack(
        "makehuman_system_assets_cc0",
        f"{_MIRROR}/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip",
    ),
    Pack("visemes02", f"{_MIRROR}/functional/visemes02.zip"),
    Pack("faceunits01", f"{_MIRROR}/functional/faceunits01.zip"),
)


def mpfb_data_dir() -> Path:
    return Path(os.environ.get("MPFB_USER_DATA", _DEFAULT_MPFB_DATA))


def safe_extract(archive: zipfile.ZipFile, dest: Path) -> None:
    """Extract an archive, refusing entries that would escape `dest` (zip slip)."""
    root = dest.resolve()
    for member in archive.infolist():
        target = (root / member.filename).resolve()
        if not target.is_relative_to(root):
            raise ValueError(f"Unsafe path in archive: {member.filename}")
    archive.extractall(root)


def download(pack: Pack, cache_dir: Path) -> Path:
    cache_dir.mkdir(parents=True, exist_ok=True)
    target = cache_dir / f"{pack.name}.zip"
    if not target.exists():
        tmp = target.with_suffix(".part")
        urllib.request.urlretrieve(pack.url, tmp)
        tmp.rename(target)
    return target


def install(pack: Pack, cache_dir: Path, data_dir: Path) -> bool:
    """Install a pack once; returns False when it was already installed."""
    marker = data_dir / "packs" / f"{pack.name}.installed"
    if marker.exists():
        return False
    archive_path = download(pack, cache_dir)
    with zipfile.ZipFile(archive_path) as archive:
        safe_extract(archive, data_dir)
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(pack.url)
    return True
