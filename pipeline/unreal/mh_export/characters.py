"""Export every MetaHuman preset: 8K textures, blendshape rig, DCC files, settings.

Per preset, in this order (Epic's tests rig first, then fetch textures):
1. Copy the preset into the project; presets themselves are read-only plugin content.
2. Ask for 8K on every texture group through the skin settings; the texture
   request has no resolution argument of its own.
3. Auto-rig with joints + blend shapes (MetaHuman cloud, blocking).
4. Download texture sources (MetaHuman cloud, blocking).
5. DCC Export without baked makeup, then again with makeup baked; files the
   second export shares byte-for-byte with the first are dropped.
6. Dump every editor property (skin, eyes, makeup, head, body) as text.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

import unreal

from mh_export import inventory, ue
from mh_export.archive import (
    Archive,
    JobLog,
    SkipList,
    Unit,
    drop_shared_files,
    run_units,
    write_json,
)

PRESETS_ROOT = "/MetaHumanCharacter/Optional/Presets"
WORK_ROOT = "/Game/MHExport/Characters"
RESOLUTION_FIELDS = (
    "face_albedo",
    "face_normal",
    "face_cavity",
    "face_animated_maps",
    "body_albedo",
    "body_normal",
    "body_cavity",
    "body_masks",
)


def preset_paths() -> list[str]:
    inventory.scan((PRESETS_ROOT,))
    return inventory.find_assets({"MetaHumanCharacter"}, (PRESETS_ROOT,))


def request_resolution(character: unreal.MetaHumanCharacter, name: str) -> None:
    """Set every texture group to `name` ("res2k" | "res4k" | "res8k").

    ERequestTextureResolution is not a BlueprintType enum, so Python may not
    expose it; the struct's text import works either way.
    """
    skin = character.get_editor_property("skin_settings")
    wanted = skin.get_editor_property("desired_texture_sources_resolutions")
    enum = getattr(unreal, "RequestTextureResolution", None)
    if enum is not None:
        for field in RESOLUTION_FIELDS:
            wanted.set_editor_property(field, getattr(enum, name.upper()))
    else:
        value = {"res2k": "Res2k", "res4k": "Res4k", "res8k": "Res8k"}[name]
        fields = ",".join(
            f"{''.join(part.title() for part in field.split('_'))}={value}"
            for field in RESOLUTION_FIELDS
        )
        wanted.import_text(f"({fields})")
    skin.set_editor_property("desired_texture_sources_resolutions", wanted)
    ue.subsystem().commit_skin_settings(character, skin)
    applied = character.get_editor_property("skin_settings").get_editor_property(
        "desired_texture_sources_resolutions"
    )
    if name[3:] not in str(ue.to_text(applied)).lower():
        raise RuntimeError(f"Texture resolution not applied: {ue.to_text(applied)}")


def has_high_resolution_textures(character: unreal.MetaHumanCharacter) -> bool:
    value = character.has_high_resolution_textures
    return bool(value() if callable(value) else value)


def joints_and_blend_shapes() -> unreal.MetaHumanRigType:
    """EMetaHumanRigType::JointsAndBlendShapes as Python exposes it."""
    for name in ("JOINTS_AND_BLEND_SHAPES", "JOINTS_AND_BLENDSHAPES"):
        if hasattr(unreal.MetaHumanRigType, name):
            return getattr(unreal.MetaHumanRigType, name)
    raise RuntimeError(f"No joints + blend shapes rig type in {dir(unreal.MetaHumanRigType)}")


def rig(character: unreal.MetaHumanCharacter) -> None:
    params = unreal.MetaHumanCharacterAutoRiggingRequestParams()
    params.blocking = True
    params.report_progress = False
    params.rig_type = joints_and_blend_shapes()
    ue.subsystem().request_auto_rigging(character, params)


def download_textures(character: unreal.MetaHumanCharacter) -> None:
    params = unreal.MetaHumanCharacterTextureRequestParams()
    params.blocking = True
    params.report_progress = False
    ue.subsystem().request_texture_sources(character, params)
    if not has_high_resolution_textures(character):
        raise RuntimeError("Texture request finished without high resolution textures")


def export_dcc(character: unreal.MetaHumanCharacter, out_dir: Path, bake_makeup: bool) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    params = unreal.MetaHumanDCCExportParams()
    params.external_path = str(out_dir)
    params.archive_name = character.get_name()
    params.bake_make_up = bake_makeup
    params.compress_in_zip_file = False
    unreal.MetaHumanCharacterExportBlueprintLibrary.export_dcc(character, params)
    if not any(path.is_file() for path in out_dir.rglob("*")):
        raise RuntimeError(f"DCC export wrote nothing to {out_dir}")


def export_preset(preset: str, work: Path, texture_resolution: str) -> dict[str, Any]:
    name = preset.rsplit(".", 1)[-1]
    character = ue.duplicate(preset, f"{WORK_ROOT}/{name}.{name}")
    with ue.editing(character):
        request_resolution(character, texture_resolution)
        rig(character)
        download_textures(character)
        export_dcc(character, work / "dcc", bake_makeup=False)
        export_dcc(character, work / "dcc_makeup", bake_makeup=True)
        dropped = drop_shared_files(work / "dcc", work / "dcc_makeup")
        if (work / "dcc_makeup").exists() and not any((work / "dcc_makeup").iterdir()):
            shutil.rmtree(work / "dcc_makeup")
        write_json(work / "settings.json", ue.dump_properties(character))
    return {
        "preset": preset,
        "project_copy": character.get_path_name(),
        "texture_resolution": texture_resolution,
        "rig_type": "JOINTS_AND_BLENDSHAPES",
        "makeup_files_identical_to_clean": dropped,
    }


def run(archive: Archive, args: dict[str, Any]) -> dict[str, Any]:
    """Args: only (list of preset names), resolution ("res2k"|"res4k"|"res8k"), force."""
    only = set(args.get("only") or [])
    texture_resolution = args.get("resolution", "res8k")
    presets = [p for p in preset_paths() if not only or p.rsplit(".", 1)[-1] in only]
    if not presets:
        raise RuntimeError(f"No presets matched under {PRESETS_ROOT} (only={sorted(only)})")
    units = [
        Unit(
            # Skip-list names look like "characters/Ada".
            name=f"characters/{preset.rsplit('.', 1)[-1]}",
            directory=archive.unit_dir("characters", preset.rsplit(".", 1)[-1]),
            export=lambda work, preset=preset: export_preset(preset, work, texture_resolution),
        )
        for preset in presets
    ]
    log = JobLog(archive.logs, "characters")
    summary = run_units(units, log, force=bool(args.get("force")), skip=SkipList(archive.skip_file))
    return {"presets": len(presets), "log": str(log.path), **summary.as_dict()}
