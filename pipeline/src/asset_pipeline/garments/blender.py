"""Run `pipeline/blender/garment_sim.py` in a headless Blender."""

import json
import os
import subprocess
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from asset_pipeline.config import PIPELINE_ROOT
from asset_pipeline.garments import GarmentError
from asset_pipeline.garments.body import BaseBody
from asset_pipeline.garments.flat import FlatMesh
from asset_pipeline.garments.pattern import GarmentMesh

SIM_SCRIPT = PIPELINE_ROOT / "blender" / "garment_sim.py"
TOOLS = Path.home() / "tools"


def find_blender() -> Path:
    """`$BLENDER`, else the newest `~/tools/blender-*/blender[.exe]`."""
    configured = os.environ.get("BLENDER")
    if configured:
        path = Path(configured)
        if path.is_file():
            return path
        raise GarmentError(f"BLENDER={configured} does not exist")
    for folder in sorted(TOOLS.glob("blender-*"), reverse=True):
        for name in ("blender.exe", "blender"):
            if (folder / name).is_file():
                return folder / name
    raise GarmentError(f"no Blender: set BLENDER or unpack one under {TOOLS}")


def write_job(
    work: Path,
    garment: GarmentMesh | FlatMesh,
    body: BaseBody,
    material: str,
    sim: dict[str, Any],
    thickness: float,
    collider: tuple[NDArray[np.float64], NDArray[np.int64]] | None = None,
) -> Path:
    """`collider` replaces the body as the cloth's collision mesh (the body closed at
    the neck, `garments.collider`)."""
    work.mkdir(parents=True, exist_ok=True)
    positions, triangles = collider or (body.positions, body.triangles)
    job = {
        "garment": garment.to_json(),
        "body": {
            "positions": np.round(positions, 6).tolist(),
            "triangles": triangles.tolist(),
        },
        "material": material,
        "sim": sim,
        "thickness": thickness,
        "out": str(work / "draped.glb"),
        "report": str(work / "sim.json"),
    }
    path = work / "job.json"
    path.write_text(json.dumps(job), encoding="utf-8")
    return path


def run_sim(job: Path, timeout: float = 1800.0) -> dict[str, Any]:
    command = [
        str(find_blender()),
        "--background",
        "--factory-startup",
        "--python",
        str(SIM_SCRIPT),
        "--",
        str(job),
    ]
    completed = subprocess.run(
        command, capture_output=True, text=True, timeout=timeout, check=False
    )
    report_path = Path(json.loads(job.read_text(encoding="utf-8"))["report"])
    if completed.returncode != 0 or not report_path.is_file():
        tail = "\n".join((completed.stdout + completed.stderr).splitlines()[-20:])
        raise GarmentError(f"Blender failed ({completed.returncode}):\n{tail}")
    return json.loads(report_path.read_text(encoding="utf-8"))
