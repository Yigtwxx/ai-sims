"""Export every MetaHuman preset: high-res textures, blendshape rig, DCC files, settings.

Per character, in this order (Epic's tests rig first, then fetch textures):
1. Copy the preset into the project; presets themselves are read-only plugin content.
2. Ask for the texture resolutions through the skin settings (face 8K, body 4K by
   default: 8K body requests fail on Epic's side with "Server Error").
3. Auto-rig with joints + blend shapes (MetaHuman cloud, blocking).
4. Download texture sources (MetaHuman cloud, blocking).
5. DCC Export without baked makeup, then again with makeup baked; files the
   second export shares byte-for-byte with the first are dropped. DCC Export
   bakes its maps through texture graphs at a fixed 2K, so:
6. Materials export persists the full-resolution synthesized face and body
   textures as project assets, which are then written out as PNG sources.
7. Dump every editor property (skin, eyes, makeup, head, body) as text.
"""

from __future__ import annotations

import shutil
import time
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
from mh_export.exporters import export_texture

PRESETS_ROOT = "/MetaHumanCharacter/Optional/Presets"
EXTRA_ROOTS = ("/Game/Fab",)  # Fab character assets (e.g. the Vampire) land here
WORK_ROOT = "/Game/MHExport/Characters"
MATERIALS_ROOT = "/Game/MHExport/Materials"
FACE_FIELDS = ("face_albedo", "face_normal", "face_cavity", "face_animated_maps")
BODY_FIELDS = ("body_albedo", "body_normal", "body_cavity", "body_masks")
RESOLUTIONS = {"res2k": "Res2k", "res4k": "Res4k", "res8k": "Res8k"}
# Epic's texture service intermittently answers "Server Error"; the export then
# silently lacks maps, so every unit is checked and the request retried.
TEXTURE_ATTEMPTS = 3
RETRY_PAUSE_SECONDS = 45
REQUIRED_DCC_FILES = (
    "head.dna",
    "body.dna",
    "Maps/Head_Basecolor.png",
    "Maps/Head_Normal.png",
    "Maps/Head_SRMF.png",
    "Maps/Head_Basecolor_Animated_CM1.png",
    "Maps/Head_Normal_Animated_WM1.png",
    "Maps/Body_Basecolor.png",
    "Maps/Body_Normal.png",
    "Maps/Eyes_Color.png",
    "Maps/Teeth_Color.png",
)
REQUIRED_SOURCE_TEXTURES = {
    "face": ("Basecolor", "Normal", "Cavity", "Animated_CM1", "Animated_WM1"),
    "body": ("Basecolor", "Normal"),
}


def preset_paths() -> list[str]:
    inventory.scan((PRESETS_ROOT,))
    return inventory.find_assets({"MetaHumanCharacter"}, (PRESETS_ROOT,))


def fab_character_paths() -> list[str]:
    inventory.scan(EXTRA_ROOTS)
    return inventory.find_assets({"MetaHumanCharacter"}, EXTRA_ROOTS)


def request_resolution(character: unreal.MetaHumanCharacter, face: str, body: str) -> None:
    """Set the face and body texture groups ("res2k" | "res4k" | "res8k").

    ERequestTextureResolution is not a BlueprintType enum, so Python may not
    expose it; the struct's text import works either way.
    """
    skin = character.get_editor_property("skin_settings")
    wanted = skin.get_editor_property("desired_texture_sources_resolutions")
    enum = getattr(unreal, "RequestTextureResolution", None)
    plan = {**dict.fromkeys(FACE_FIELDS, face), **dict.fromkeys(BODY_FIELDS, body)}
    if enum is not None:
        for field, name in plan.items():
            wanted.set_editor_property(field, getattr(enum, name.upper()))
    else:
        fields = ",".join(
            f"{''.join(part.title() for part in field.split('_'))}={RESOLUTIONS[name]}"
            for field, name in plan.items()
        )
        wanted.import_text(f"({fields})")
    skin.set_editor_property("desired_texture_sources_resolutions", wanted)
    ue.subsystem().commit_skin_settings(character, skin)
    applied = str(
        ue.to_text(
            character.get_editor_property("skin_settings").get_editor_property(
                "desired_texture_sources_resolutions"
            )
        )
    ).lower()
    for name in {face, body}:
        if name[3:] not in applied:
            raise RuntimeError(f"Texture resolution not applied: {applied}")


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


def export_dcc(character: unreal.MetaHumanCharacter, out_dir: Path, bake_makeup: bool) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    params = unreal.MetaHumanDCCExportParams()
    params.external_path = str(out_dir)
    params.archive_name = character.get_name()
    params.bake_make_up = bake_makeup
    params.compress_in_zip_file = False
    unreal.MetaHumanCharacterExportBlueprintLibrary.export_dcc(character, params)
    if not any(path.is_file() for path in out_dir.rglob("*")):
        raise RuntimeError(f"DCC export wrote nothing to {out_dir}; see the MetaHuman message log")


def missing_dcc_files(dcc_dir: Path) -> list[str]:
    return [rel for rel in REQUIRED_DCC_FILES if not (dcc_dir / rel).is_file()]


def missing_source_textures(textures: dict[str, Any]) -> list[str]:
    missing = []
    for part, needles in REQUIRED_SOURCE_TEXTURES.items():
        files = [t["file"] for t in textures.values() if t["part"] == part]
        missing += [f"{part}:{n}" for n in needles if not any(n in f for f in files)]
    return missing


def export_source_textures(character: unreal.MetaHumanCharacter, out_dir: Path) -> dict[str, Any]:
    """Full-resolution synthesized face/body textures via the materials export."""
    project_path = f"{MATERIALS_ROOT}/{character.get_name()}"
    params = unreal.MetaHumanMaterialsExportParams()
    params.project_path = project_path
    params.apply_as_overrides = False
    unreal.MetaHumanCharacterExportBlueprintLibrary.export_materials(character, params)
    inventory.scan((project_path,))
    textures: dict[str, Any] = {}
    for asset in inventory.assets_under(project_path):
        if inventory.class_name(asset) != "Texture2D":
            continue
        package = str(asset.package_name)
        part = "body" if "/Body/" in package else "face"
        textures[package] = {"part": part, **export_texture(asset.get_asset(), out_dir / part)}
        textures[package]["file"] = f"{part}/{textures[package]['file']}"
    if not textures:
        raise RuntimeError(f"Materials export created no textures under {project_path}")
    return textures


def release(character: unreal.MetaHumanCharacter) -> None:
    """Unload the character and its exported materials; 8K sources stay resident otherwise."""
    packages = [character.get_outermost()]
    for asset in inventory.assets_under(f"{MATERIALS_ROOT}/{character.get_name()}"):
        loaded = unreal.find_object(None, inventory.object_path(asset))
        if loaded is not None:
            packages.append(loaded.get_outermost())
    try:
        unreal.EditorLoadingAndSavingUtils.unload_packages(packages)
    except Exception as exc:  # unloading is best effort; the process restarts every few units
        unreal.log_warning(f"[mh_export] could not unload {character.get_name()}: {exc}")
    unreal.SystemLibrary.collect_garbage()


def export_character(source: str, work: Path, face_res: str, body_res: str) -> dict[str, Any]:
    name = source.rsplit(".", 1)[-1]
    character = ue.duplicate(source, f"{WORK_ROOT}/{name}.{name}")
    with ue.editing(character):
        request_resolution(character, face_res, body_res)
        rig(character)
        missing: list[str] = []
        for attempt in range(1, TEXTURE_ATTEMPTS + 1):
            download_textures(character)
            export_dcc(character, work / "dcc", bake_makeup=False)
            missing = missing_dcc_files(work / "dcc" / name)
            if not missing:
                break
            unreal.log_warning(f"[mh_export] {name}: attempt {attempt} missing {missing}; retrying")
            shutil.rmtree(work / "dcc", ignore_errors=True)
            time.sleep(RETRY_PAUSE_SECONDS)
        if missing:
            raise RuntimeError(f"Textures unavailable after {TEXTURE_ATTEMPTS} attempts: {missing}")
        export_dcc(character, work / "dcc_makeup", bake_makeup=True)
        dropped = drop_shared_files(work / "dcc", work / "dcc_makeup")
        if (work / "dcc_makeup").exists() and not any((work / "dcc_makeup").iterdir()):
            shutil.rmtree(work / "dcc_makeup")
        sources = export_source_textures(character, work / "textures")
        if absent := missing_source_textures(sources):
            raise RuntimeError(f"Source textures missing {absent}")
        write_json(work / "textures" / "textures.json", sources)
        write_json(work / "settings.json", ue.dump_properties(character))
    # Keep the rigged, textured copy: outfit builds later reuse it without new cloud requests.
    if not unreal.EditorAssetLibrary.save_loaded_asset(character, False):
        raise RuntimeError(f"Could not save {character.get_path_name()}")
    release(character)
    return {
        "source": source,
        "project_copy": character.get_path_name(),
        "texture_resolution": {"face": face_res, "body": body_res},
        "rig_type": "JOINTS_AND_BLEND_SHAPES",
        "makeup_files_identical_to_clean": dropped,
        "source_textures": len(sources),
    }


def run(archive: Archive, args: dict[str, Any]) -> dict[str, Any]:
    """Args: only (names), face ("res8k"), body ("res4k"), fab (Fab characters), limit, force."""
    only = set(args.get("only") or [])
    face_res = args.get("face", "res8k")
    body_res = args.get("body", "res4k")
    sources = preset_paths() + (fab_character_paths() if args.get("fab", True) else [])
    sources = [p for p in sources if not only or p.rsplit(".", 1)[-1] in only]
    if not sources:
        raise RuntimeError(f"No characters matched (only={sorted(only)})")
    units = [
        Unit(
            # Skip-list names look like "characters/Ada".
            name=f"characters/{source.rsplit('.', 1)[-1]}",
            directory=archive.unit_dir("characters", source.rsplit(".", 1)[-1]),
            export=lambda work, source=source: export_character(source, work, face_res, body_res),
        )
        for source in sources
    ]
    log = JobLog(archive.logs, "characters")
    summary = run_units(
        units,
        log,
        force=bool(args.get("force")),
        skip=SkipList(archive.skip_file),
        limit=args.get("limit"),
    )
    return {"characters": len(sources), "log": str(log.path), **summary.as_dict()}
