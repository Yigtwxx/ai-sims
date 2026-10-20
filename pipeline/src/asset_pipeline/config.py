"""Filesystem locations and tool paths used by the pipeline."""

import os
from dataclasses import dataclass
from pathlib import Path

PIPELINE_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = PIPELINE_ROOT.parent

_DEFAULT_BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender"


@dataclass(frozen=True)
class Paths:
    blender_bin: Path
    blender_scripts: Path
    out_dir: Path
    web_assets: Path


def load_paths() -> Paths:
    """Resolve paths, allowing overrides via environment variables."""
    return Paths(
        blender_bin=Path(os.environ.get("BLENDER_BIN", _DEFAULT_BLENDER)),
        blender_scripts=PIPELINE_ROOT / "blender_scripts",
        out_dir=PIPELINE_ROOT / "out",
        web_assets=REPO_ROOT / "web" / "public" / "assets",
    )
