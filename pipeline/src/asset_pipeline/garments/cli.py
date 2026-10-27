"""`garment` command: draft a garment on the outfit-base body, drape it in Blender and write
it as an archive unit that `mh-convert --outfits --outfit <name>` then converts.

    uv run asset-pipeline garment --item AS_PencilSkirt --gender female
"""

import argparse
import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from asset_pipeline.garments import GarmentError
from asset_pipeline.garments.blender import run_sim, write_job
from asset_pipeline.garments.body import BaseBody, load_base_body
from asset_pipeline.garments.pack import GarmentLines, write_unit
from asset_pipeline.garments.pattern import GarmentMesh
from asset_pipeline.garments.skirt import draft_pencil_skirt, skirt_lines
from asset_pipeline.mh.convert import archive_root
from asset_pipeline.mh.geometry import closest_triangles
from asset_pipeline.mh.glb import accessor_values, read_glb
from asset_pipeline.mh.outfits import base_body_path

COMMAND = "garment"
MIN_CLEARANCE = 0.001  # metres between the draped cloth and the skin


@dataclass(frozen=True)
class Item:
    genders: tuple[str, ...]
    draft: Callable[[BaseBody], tuple[GarmentMesh, GarmentLines]]
    switches: dict[str, bool]


def _pencil_skirt(body: BaseBody) -> tuple[GarmentMesh, GarmentLines]:
    draft = draft_pencil_skirt(body)
    return draft.mesh, skirt_lines(draft)


ITEMS = {
    # Suiting: no pilling.
    "AS_PencilSkirt": Item(("female",), _pencil_skirt, {"DoPill": False}),
}


def add_parser(
    subparsers: "argparse._SubParsersAction[argparse.ArgumentParser]",
) -> argparse.ArgumentParser:
    parser = subparsers.add_parser(COMMAND, help="Draft, drape (Blender) and pack our garments")
    parser.add_argument("--item", choices=sorted(ITEMS), required=True)
    parser.add_argument("--gender", choices=("female", "male"), action="append")
    parser.add_argument("--frames", type=int, default=40, help="cloth simulation frames")
    parser.add_argument("--archive", type=Path, help="MetaHumanArchive root (default: $MH_ARCHIVE)")
    return parser


def clearance(glb: Path, body: BaseBody) -> float:
    """Smallest distance from the draped garment's vertices to the body surface."""
    document, binary = read_glb(glb.read_bytes())
    positions = accessor_values(
        document, binary, document["meshes"][0]["primitives"][0]["attributes"]["POSITION"]
    )
    _, _, distance = closest_triangles(positions, body.positions, body.triangles, candidates=8)
    return float(np.min(distance))


def build(archive: Path, name: str, gender: str, frames: int) -> dict[str, object]:
    item = ITEMS[name]
    body = load_base_body(base_body_path(archive, gender))
    mesh, lines = item.draft(body)
    work = archive / "build" / "garments" / name / gender
    job = write_job(work, mesh, body, f"MI_{name}", {"frames": frames}, thickness=0.002)
    report = run_sim(job)
    draped = Path(str(report["out"]))
    gap = clearance(draped, body)
    if gap < MIN_CLEARANCE:
        raise GarmentError(f"{name} ({gender}) sinks into the body: {gap * 1000:.1f} mm")
    unit = write_unit(archive, gender, name, draped, lines, mesh.uv_metres, item.switches)
    return {**report, "clearance_mm": round(gap * 1000, 2), "unit": str(unit)}


def run(args: argparse.Namespace) -> int:
    archive = args.archive or archive_root()
    item = ITEMS[args.item]
    genders = args.gender or list(item.genders)
    for gender in genders:
        if gender not in item.genders:
            raise GarmentError(f"{args.item} is not drafted for {gender}")
        print(
            json.dumps(
                {
                    "item": args.item,
                    "gender": gender,
                    **build(archive, args.item, gender, args.frames),
                },
                indent=2,
            )
        )
    return 0
