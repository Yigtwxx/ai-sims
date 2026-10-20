"""Export a body shape basis from the MetaHuman parametric body model.

The web creator offers realistic body sliders (height, weight, muscle, bust,
waist, hips, shoulders) instead of plain scaling. For each gender a neutral
body is solved from the parametric model, then every slider is pushed to a
lower and an upper target while the rest of the neutral constraints stay put.
Each solved body is written as a body DNA (geometry + skeleton); the converter
turns the differences into morph targets and joint offsets, so a slider moves
the mesh and the bones the way MetaHuman's own body model does.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import unreal

from mh_export import ue
from mh_export.archive import Archive, JobLog, SkipList, Unit, run_units, write_json

WORK_ROOT = "/Game/MHExport/Bodies"
# Masculine/Feminine axis value and neutral height (cm) per gender.
GENDERS = {
    "female": {"Masculine/Feminine": 1.0, "Height": 166.0},
    "male": {"Masculine/Feminine": -1.0, "Height": 178.0},
}
NEUTRAL_SHAPE = {"Fat": 0.0, "Muscularity": 0.0}
# slider id -> (constraint name, delta applied below/above the neutral measurement)
SLIDERS = {
    "height": ("Height", 14.0),
    "weight": ("Fat", 1.6),
    "muscle": ("Muscularity", 1.5),
    "chest": ("Chest", 14.0),
    "waist": ("Waist", 12.0),
    "hips": ("Hip", 12.0),
    "shoulders": ("Across Shoulder", 4.0),
}


def create_character(name: str) -> unreal.MetaHumanCharacter:
    path = f"{WORK_ROOT}/{name}.{name}"
    existing = unreal.load_asset(path)
    if existing is not None:
        return existing
    return unreal.AssetToolsHelpers.get_asset_tools().create_asset(
        asset_name=name,
        package_path=WORK_ROOT,
        asset_class=unreal.MetaHumanCharacter,
        factory=unreal.new_object(type=unreal.MetaHumanCharacterFactoryNew),
    )


def constraint_map(character: unreal.MetaHumanCharacter) -> dict[str, Any]:
    return {str(c.name): c for c in ue.subsystem().get_body_constraints(character)}


def apply(character: unreal.MetaHumanCharacter, targets: dict[str, float]) -> dict[str, Any]:
    """Activate exactly `targets`, solve, and return every resulting measurement."""
    constraints = constraint_map(character)
    missing = sorted(set(targets) - set(constraints))
    if missing:
        raise RuntimeError(f"Unknown body constraints {missing}; have {sorted(constraints)}")
    for name, constraint in constraints.items():
        constraint.is_active = name in targets
        if name in targets:
            low, high = constraint.min_measurement, constraint.max_measurement
            constraint.target_measurement = max(low, min(high, targets[name]))
    ue.subsystem().set_body_constraints(character, list(constraints.values()))
    ue.subsystem().commit_body_state(character)
    return {
        name: {
            "value": float(c.target_measurement),
            "min": float(c.min_measurement),
            "max": float(c.max_measurement),
            "active": bool(c.is_active),
        }
        for name, c in constraint_map(character).items()
    }


def export_body_dna(character: unreal.MetaHumanCharacter, out_dir: Path) -> list[str]:
    out_dir.mkdir(parents=True, exist_ok=True)
    params = unreal.MetaHumanDNAExportParams()
    params.project_path = ""
    params.external_path = str(out_dir)
    params.dna_head = False
    params.dna_body = True
    unreal.MetaHumanCharacterExportBlueprintLibrary.export_dna(character, params)
    files = sorted(p.name for p in out_dir.glob("*.dna"))
    if not files:
        raise RuntimeError(f"export_dna wrote no body DNA to {out_dir}")
    return files


def export_gender(gender: str, work: Path) -> dict[str, Any]:
    character = create_character(f"Body_{gender}")
    base = {**GENDERS[gender], **NEUTRAL_SHAPE}
    variants: dict[str, Any] = {}
    with ue.editing(character):
        neutral = apply(character, base)
        variants["neutral"] = {
            "targets": base,
            "measurements": neutral,
            "files": export_body_dna(character, work / "neutral"),
        }
        for slider, (constraint, delta) in SLIDERS.items():
            center = base.get(constraint, neutral[constraint]["value"])
            for sign, label in ((-1, "min"), (1, "max")):
                targets = {**base, constraint: center + sign * delta}
                key = f"{slider}_{label}"
                measured = apply(character, targets)
                variants[key] = {
                    "slider": slider,
                    "constraint": constraint,
                    "targets": targets,
                    "measurements": measured,
                    "files": export_body_dna(character, work / key),
                }
        apply(character, base)
    write_json(work / "bodies.json", {"gender": gender, "sliders": SLIDERS, "variants": variants})
    return {"gender": gender, "variants": len(variants)}


def run(archive: Archive, args: dict[str, Any]) -> dict[str, Any]:
    """Args: genders (list), force."""
    genders = args.get("genders") or list(GENDERS)
    units = [
        Unit(
            name=f"bodies/{gender}",
            directory=archive.unit_dir("bodies", gender),
            export=lambda work, gender=gender: export_gender(gender, work),
        )
        for gender in genders
    ]
    log = JobLog(archive.logs, "bodies")
    summary = run_units(units, log, force=bool(args.get("force")), skip=SkipList(archive.skip_file))
    return {"genders": len(units), "log": str(log.path), **summary.as_dict()}
