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
from asset_pipeline.garments.collider import Neck, closed_body, neck
from asset_pipeline.garments.flat import FlatMesh
from asset_pipeline.garments.pack import TEMPLATE, GarmentLines, Look, metres_per_uv, write_unit
from asset_pipeline.garments.pattern import GarmentMesh
from asset_pipeline.garments.shorts import (
    DENIM_MINI_SHORTS,
    DENIM_SHORTS,
    MINI_SHORTS,
    ShortsSpec,
    draft_shorts,
    shorts_lines,
)
from asset_pipeline.garments.skirt import draft_pencil_skirt, skirt_lines
from asset_pipeline.garments.tee import TEE_FEMALE, TEE_MALE, draft_tee, tee_lines
from asset_pipeline.mh.convert import archive_root
from asset_pipeline.mh.geometry import closest_triangles
from asset_pipeline.mh.glb import accessor_values, read_glb
from asset_pipeline.mh.outfits import base_body_path

COMMAND = "garment"
MIN_CLEARANCE = 0.001  # metres between the draped cloth and the skin


Draft = Callable[[BaseBody, Neck | None, str], tuple[GarmentMesh | FlatMesh, GarmentLines]]


@dataclass(frozen=True)
class Item:
    genders: tuple[str, ...]
    draft: Draft
    switches: dict[str, bool]
    sim: dict[str, float]  # cloth settings over garment_sim.py's defaults
    neck: bool = False  # reaches the neck: drape against the body closed by a head
    thickness: float = 0.002
    template: str = TEMPLATE  # the Epic unit whose material is the starting point
    denim: bool = False  # `denim_look` on the template's material


def _pencil_skirt(
    body: BaseBody, neck: Neck | None, gender: str
) -> tuple[GarmentMesh, GarmentLines]:
    draft = draft_pencil_skirt(body)
    return draft.mesh, skirt_lines(draft)


def _shorts(spec: ShortsSpec) -> Draft:
    def draft(body: BaseBody, neck: Neck | None, gender: str) -> tuple[FlatMesh, GarmentLines]:
        shorts = draft_shorts(body, spec)
        return shorts.mesh, shorts_lines(shorts, spec)

    return draft


def denim_look(archive: Path, gender: str, uv_metres: float) -> Look:
    """Jeans twill and its washed streaks (Epic's jeans' tiling maps) on the fabric
    shader, so wash presets work; tiles as big as on the jeans."""
    jeans = archive / "raw" / "outfits" / gender / "WI_OA_Jeans"
    metres = metres_per_uv(jeans / f"OutfitBase_{gender}_Outfits.glb")
    return Look(
        textures={
            "detailTex_normal": jeans / "textures" / "micro_jeans_tile_N.png",
            "MacroTex_Variation": jeans / "textures" / "btm_jeans_nrm_tile_overlay_D.png",
        },
        scalars={
            "DetailTex_UVTtiling": uv_metres / (metres / 500.0),
            "DetailTex_NormalStrength": 1.0,
            "MacroTex_UvTiling": uv_metres / (metres / 7.0),
            "MacroTexStrength": 0.6,
        },
    )


def _crew_tee(body: BaseBody, neck: Neck | None, gender: str) -> tuple[FlatMesh, GarmentLines]:
    if neck is None:
        raise GarmentError("the tee is draped against the neck")
    spec = TEE_FEMALE if gender == "female" else TEE_MALE
    draft = draft_tee(body, neck, spec)
    return draft.mesh, tee_lines(draft, spec)


# Cotton jersey: soft and stretchy, sewn from flat pieces; gravity comes after the seams.
JERSEY = {
    "frames": 50.0,
    "sew_frames": 60.0,
    "gravity_ramp": 10.0,
    "self_collision": 1.0,
    "quality": 8.0,
    # Rests a little off the skin: by the neck and the armholes the skin stays drawn and
    # poses and thin bodies would push it through cloth lying right on it.
    "collision_distance": 0.005,
    "min_gap": 0.004,
    "friction": 2.0,
    "bending": 0.5,
    "tension": 15.0,
    "compression": 15.0,
    "shear": 5.0,
}

# Cotton twill for shorts: stiffer than jersey; it rests closer to the skin than the tee
# so the cloth between the thighs has room.
TWILL = {
    **JERSEY,
    "frames": 70.0,
    "bending": 1.0,
    "tension": 30.0,
    "compression": 30.0,
    "shear": 10.0,
    "collision_distance": 0.0025,
    "min_gap": 0.002,
    "self_distance": 0.0015,
    "friction": 1.0,
}

DENIM = {**TWILL, "bending": 1.5, "tension": 40.0, "compression": 40.0}
DENIM_SWITCHES = {
    "DoPill": False,
    "DoFuzz": False,
    "DoDetailVariation": False,
    "DoMacroVariation": True,
    "DoDetailNormal": True,
    "DoPaintedWear": True,
}

ITEMS = {
    # Wool suiting: no pilling, and stiff enough not to fold into the gap between the legs.
    "AS_PencilSkirt": Item(("female",), _pencil_skirt, {"DoPill": False}, {"bending": 8.0}),
    # Smooth combed cotton: no fuzz, pills or heathered fleck (the template is a worn tee).
    "AS_CrewTee": Item(
        ("female", "male"),
        _crew_tee,
        {"DoPill": False, "DoFuzz": False, "DoDetailVariation": False},
        JERSEY,
        neck=True,
        thickness=0.0015,
    ),
    "AS_MiniShorts": Item(
        ("female",),
        _shorts(MINI_SHORTS),
        {"DoPill": False, "DoFuzz": False},
        TWILL,
        thickness=0.0018,
        template="WI_OA_Shorts",
    ),
    # Denim on the fabric shader (the jeans master takes no colours): twill, washed
    # streaks, faded seams and gold topstitching.
    "AS_DenimMiniShorts": Item(
        ("female",),
        _shorts(DENIM_MINI_SHORTS),
        DENIM_SWITCHES,
        DENIM,
        thickness=0.0022,
        denim=True,
    ),
    "AS_DenimShorts": Item(
        ("male",),
        _shorts(DENIM_SHORTS),
        DENIM_SWITCHES,
        DENIM,
        thickness=0.0022,
        denim=True,
    ),
}


def add_parser(
    subparsers: "argparse._SubParsersAction[argparse.ArgumentParser]",
) -> argparse.ArgumentParser:
    parser = subparsers.add_parser(COMMAND, help="Draft, drape (Blender) and pack our garments")
    parser.add_argument("--item", choices=sorted(ITEMS), required=True)
    parser.add_argument("--gender", choices=("female", "male"), action="append")
    parser.add_argument("--frames", type=int, help="cloth simulation frames (after sewing)")
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


def build(archive: Path, name: str, gender: str, frames: int | None) -> dict[str, object]:
    item = ITEMS[name]
    body = load_base_body(base_body_path(archive, gender))
    neck_part = neck(archive, gender) if item.neck else None
    mesh, lines = item.draft(body, neck_part, gender)
    work = archive / "build" / "garments" / name / gender
    sim = {**item.sim, **({"frames": frames} if frames else {})}
    collider = closed_body(body, neck_part) if neck_part is not None else None
    job = write_job(work, mesh, body, f"MI_{name}", sim, item.thickness, collider)
    report = run_sim(job)
    draped = Path(str(report["out"]))
    gap = clearance(draped, body)
    if gap < MIN_CLEARANCE:
        raise GarmentError(f"{name} ({gender}) sinks into the body: {gap * 1000:.1f} mm")
    look = denim_look(archive, gender, mesh.uv_metres) if item.denim else None
    unit = write_unit(
        archive, gender, name, draped, lines, mesh.uv_metres, item.switches, item.template, look
    )
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
