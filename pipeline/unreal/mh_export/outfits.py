"""Export every outfit wardrobe item fitted to each gender's neutral body.

Outfits (the built-in default garment and the Fab .mhpkg items) are Chaos
outfits that Unreal resizes to a body only while assembling a character. So for
each gender a base character is rigged once (2K textures are enough to build),
set to the neutral body from the bodies job, and then for every outfit item:
the item is put in the "Outfits" slot, the character is built with the
optimized pipeline, and the fitted clothing skeletal meshes are exported as GLB
(converter input) and FBX (archive), with their material parameters and
textures. Body sliders later move the outfit through surface binding on the
web side, so only the neutral body is built here.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import unreal

from mh_export import bodies, characters, inventory, materials, ue
from mh_export.archive import (
    Archive,
    JobLog,
    SkipList,
    Unit,
    run_units,
    safe_name,
    write_json,
)
from mh_export.exporters import export_gltf, export_object, export_texture, fbx_options

SLOT = "Outfits"
ROOTS = ("/MetaHumanCharacter/Optional/Clothing", "/Game/Fab")
BUILD_ROOT = "/Game/MHExport/Builds"
BASE_ROOT = "/Game/MHExport/Scratch"
# A preset per gender to copy as the build base (its face does not matter here).
BASE_PRESETS = {"female": "Ada", "male": "Bruce"}


def outfit_items() -> list[str]:
    """Wardrobe items that are not grooms, from the plugin and the Fab imports.

    Fab hair packages sit next to the outfits under /Game/Fab, so grooms are told
    apart by the asset each item wraps, not by folder.
    """
    inventory.scan(ROOTS)
    return [
        p
        for p in inventory.find_assets({"MetaHumanWardrobeItem"}, ROOTS)
        if "/Grooms/" not in p
        and "/Bindings/" not in p
        and ue.groom_slot(unreal.load_asset(p)) is None
    ]


def base_character(gender: str) -> unreal.MetaHumanCharacter:
    """Rigged, textured copy of a preset with the neutral body; built once, then reused."""
    name = f"OutfitBase_{gender}"
    path = f"{BASE_ROOT}/{name}.{name}"
    existing = unreal.load_asset(path)
    if existing is not None:
        return existing
    preset = next(p for p in characters.preset_paths() if p.endswith(f".{BASE_PRESETS[gender]}"))
    character = ue.duplicate(preset, path)
    with ue.editing(character):
        characters.request_resolution(character, "res2k", "res2k")
        characters.rig(character)
        characters.download_textures(character)
        bodies.apply(character, {**bodies.GENDERS[gender], **bodies.NEUTRAL_SHAPE})
    if not unreal.EditorAssetLibrary.save_loaded_asset(character, False):
        raise RuntimeError(f"Could not save {path}")
    return character


def build(character: unreal.MetaHumanCharacter, build_path: str) -> str | None:
    params = unreal.MetaHumanCharacterEditorBuildParameters()
    params.pipeline_type = unreal.MetaHumanDefaultPipelineType.OPTIMIZED
    params.pipeline_quality = unreal.MetaHumanQualityLevel.HIGH
    params.absolute_build_path = build_path
    params.common_folder_path = f"{build_path}/Common"
    params.enable_wardrobe_item_validation = False
    try:
        ue.subsystem().build_meta_human(character=character, params=params)
    except Exception as exc:  # control rig copy warnings surface as exceptions; the build lands
        return str(exc)[:1000]
    return None


def material_textures(mi: unreal.MaterialInstance) -> list[unreal.Texture]:
    found = []
    for name in unreal.MaterialEditingLibrary.get_texture_parameter_names(mi):
        texture = unreal.MaterialEditingLibrary.get_material_instance_texture_parameter_value(
            mi, name
        )
        if isinstance(texture, unreal.Texture):
            found.append(texture)
    return found


def export_outfit(gender: str, item_path: str, work: Path) -> dict[str, Any]:
    character = base_character(gender)
    item = unreal.load_asset(item_path)
    build_path = f"{BUILD_ROOT}/{gender}"
    clothing_dir = f"{build_path}/{character.get_name()}/Clothing"
    for stale in inventory.assets_under(clothing_dir):
        unreal.EditorAssetLibrary.delete_asset(inventory.object_path(stale))
    with ue.editing(character):
        key = ue.palette_key(character, SLOT, item)
        ue.select_only(character, SLOT, key)
        params = [
            ue.dump_properties(p)
            for p in character.internal_collection.default_instance.get_instance_parameters(
                item_path=unreal.MetaHumanPaletteItemPath(item_key=key)
            )
        ]
        build_warning = build(character, build_path)
        ue.select_only(character, SLOT)

    inventory.scan((clothing_dir,))
    built = inventory.assets_under(clothing_dir)
    meshes: dict[str, Any] = {}
    textures: dict[str, Any] = {}
    instances: dict[str, Any] = {}

    def add_instance(path: str, mi: unreal.MaterialInstance) -> None:
        instances[path] = materials.dump_instance(mi)
        for texture in material_textures(mi):
            key = texture.get_path_name()
            if key in textures:
                continue
            try:
                textures[key] = export_texture(texture, work / "textures")
            except RuntimeError as exc:
                # Constant helper maps (e.g. DefaultMaps/black_masks) have no
                # source art to export; the material dump still names them.
                textures[key] = {"error": str(exc)}

    slot_materials: list[unreal.MaterialInterface] = []
    for asset in built:
        cls = inventory.class_name(asset)
        obj = asset.get_asset()
        if cls == "SkeletalMesh":
            glb = work / f"{asset.asset_name}.glb"
            fbx = work / f"{asset.asset_name}.fbx"
            meshes[str(asset.asset_name)] = {
                "glb": glb.name if export_gltf(obj, glb) else None,
                "fbx": fbx.name if export_object(obj, fbx, fbx_options()) else None,
            }
            slot_materials += [s.material_interface for s in obj.get_editor_property("materials")]
        elif cls == "MaterialInstanceConstant":
            add_instance(inventory.object_path(asset), obj)
    # Some items (e.g. OA_Shirt_01/04) keep their own instances on the built
    # mesh instead of copies under Clothing: dump those from the mesh slots.
    for mi in slot_materials:
        if isinstance(mi, unreal.MaterialInstance):
            path = mi.get_path_name()
            if path not in instances:
                add_instance(path, mi)
    if not any(m["glb"] for m in meshes.values()):
        raise RuntimeError(f"No fitted clothing mesh was built for {item_path}: {build_warning}")
    write_json(
        work / "outfit.json",
        {
            "item": item_path,
            "gender": gender,
            "item_properties": ue.dump_properties(item),
            "parameters": params,
            "meshes": meshes,
            "materials": instances,
            "textures": textures,
            "build_warning": build_warning,
        },
    )
    return {"item": item_path, "gender": gender, "meshes": len(meshes), "textures": len(textures)}


def export_base_body(gender: str, work: Path) -> dict[str, Any]:
    """The neutral body the outfits were fitted to, as built (GLB + FBX)."""
    character = base_character(gender)
    build_path = f"{BUILD_ROOT}/{gender}"
    with ue.editing(character):
        ue.select_only(character, SLOT)
        warning = build(character, build_path)
    body_dir = f"{build_path}/{character.get_name()}/Body"
    inventory.scan((body_dir,))
    meshes = [
        a for a in inventory.assets_under(body_dir) if inventory.class_name(a) == "SkeletalMesh"
    ]
    if not meshes:
        raise RuntimeError(f"No body mesh under {body_dir}: {warning}")
    exported = {}
    for asset in meshes:
        obj = asset.get_asset()
        exported[str(asset.asset_name)] = {
            "glb": export_gltf(obj, work / f"{asset.asset_name}.glb"),
            "fbx": export_object(obj, work / f"{asset.asset_name}.fbx", fbx_options()),
        }
    write_json(work / "body.json", {"gender": gender, "meshes": exported, "build_warning": warning})
    return {"gender": gender, "meshes": len(exported)}


def run(archive: Archive, args: dict[str, Any]) -> dict[str, Any]:
    """Args: genders (list), only (item names), limit, force."""
    genders = args.get("genders") or list(BASE_PRESETS)
    only = set(args.get("only") or [])
    items = [p for p in outfit_items() if not only or p.rsplit(".", 1)[-1] in only]
    units: list[Unit] = []
    for gender in genders:
        units.append(
            Unit(
                name=f"outfits/{gender}/_body",
                directory=archive.unit_dir("outfits", gender, "_body"),
                export=lambda work, gender=gender: export_base_body(gender, work),
            )
        )
        for item in items:
            name = safe_name(item.rsplit(".", 1)[-1])
            units.append(
                Unit(
                    name=f"outfits/{gender}/{name}",
                    directory=archive.unit_dir("outfits", gender, name),
                    export=lambda work, gender=gender, item=item: export_outfit(gender, item, work),
                )
            )
    log = JobLog(archive.logs, "outfits")
    summary = run_units(
        units,
        log,
        force=bool(args.get("force")),
        skip=SkipList(archive.skip_file),
        limit=args.get("limit"),
    )
    return {"items": len(items), "units": len(units), "log": str(log.path), **summary.as_dict()}
