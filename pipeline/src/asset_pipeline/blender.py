"""Thin wrapper for running Python scripts inside headless Blender."""

import subprocess
from pathlib import Path

from asset_pipeline.config import Paths


class BlenderError(RuntimeError):
    """Raised when a headless Blender run exits with a non-zero status."""


def build_command(paths: Paths, script: str, script_args: list[str]) -> list[str]:
    """Build the argv for `blender -b --python <script> -- <args>`."""
    script_path = paths.blender_scripts / script
    return [
        str(paths.blender_bin),
        "--background",
        "--factory-startup",
        "--addons",
        "bl_ext.blender_org.mpfb",
        "--python-exit-code",
        "1",
        "--python",
        str(script_path),
        "--",
        *script_args,
    ]


def run_blender(paths: Paths, script: str, script_args: list[str], cwd: Path | None = None) -> None:
    """Run a Blender script headlessly; raise BlenderError on failure."""
    if not paths.blender_bin.exists():
        raise BlenderError(f"Blender not found at {paths.blender_bin}; set BLENDER_BIN")
    cmd = build_command(paths, script, script_args)
    result = subprocess.run(cmd, cwd=cwd, check=False)
    if result.returncode != 0:
        raise BlenderError(f"Blender script {script} failed with exit code {result.returncode}")
