"""UDIM tile files the editor's texture exporters write (no `unreal` import, so tests run it).

A texture with several UDIM blocks (a virtual texture, e.g. the Fab Khaos garments) does not
export to the requested file: the PNG and TGA exporters write one file per block next to it,
`<stem>.<tile><ext>`, numbered like Mari tiles (1001 + u + 10 * v).
"""

from __future__ import annotations

import re
from pathlib import Path

_TILE = re.compile(r"^(?P<stem>.+)\.(?P<tile>1\d{3})$")


def tile_files(path: Path) -> dict[int, Path]:
    """Tiles written in place of `path` (`T_X.png` -> {1001: T_X.1001.png, ...}), by tile."""
    if not path.parent.is_dir():
        return {}
    tiles = {}
    for candidate in path.parent.iterdir():
        if candidate.suffix.lower() != path.suffix.lower():
            continue
        match = _TILE.match(candidate.stem)
        if match and match.group("stem") == path.stem:
            tiles[int(match.group("tile"))] = candidate
    return dict(sorted(tiles.items()))
