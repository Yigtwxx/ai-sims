"""Export every MetaHuman groom as hair cards: card meshes, atlases and metadata.

Each style folder under `GroomAssets/<slot>/<style>` holds the groom, its card
meshes (`*_CardsMesh_Group<g>_LOD<n>`), helmet meshes for the far LODs and the
card atlases. Textures the groom pulls from elsewhere in the plugin (eyelash
coverage maps, for example) are found through the asset registry dependencies.

Cards are exported as authored on the groom head; fitting them to each face
happens later on the Mac, because groom bindings only exist inside Unreal.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import unreal

from mh_export import inventory, ue
from mh_export.archive import Archive, JobLog, SkipList, Unit, run_units, write_json

GROOMS_ROOT = "/MetaHumanCharacter/Optional/Grooms"
GROOM_ASSETS = f"{GROOMS_ROOT}/GroomAssets"
BINDINGS = f"{GROOMS_ROOT}/Bindings"
GROOM_HEAD = f"{GROOMS_ROOT}/GroomMesh"
EYELASH_TEXTURES = "/MetaHumanCharacter/Textures/Eyelashes"
PLUGIN_PREFIX = "/MetaHumanCharacter/"
MESH_CLASSES = {"StaticMesh", "SkeletalMesh"}
TEXTURE_CLASSES = {"Texture2D"}
TEXTURE_EXTENSIONS = (".png", ".tga", ".exr")


def fbx_options() -> unreal.FbxExportOption:
    options = unreal.FbxExportOption()
    options.ascii = False
    options.collision = False
    options.level_of_detail = False
    options.vertex_color = True
    options.export_morph_targets = True
    return options


def export_object(obj: unreal.Object, path: Path, options: object | None = None) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    task = unreal.AssetExportTask()
    task.object = obj
    task.filename = str(path)
    task.automated = True
    task.prompt = False
    task.replace_identical = True
    if options is not None:
        task.options = options
    return bool(unreal.Exporter.run_asset_export_task(task)) and path.is_file()


def texture_info(texture: unreal.Texture2D) -> dict[str, Any]:
    return {
        "size": [texture.blueprint_get_size_x(), texture.blueprint_get_size_y()],
        **ue.dump_properties(
            texture, ["srgb", "compression_settings", "lod_group", "filter", "address_x"]
        ),
    }


def export_texture(texture: unreal.Texture2D, out_dir: Path) -> dict[str, Any]:
    """Try lossless formats in order; 16-bit and float sources may refuse PNG."""
    for extension in TEXTURE_EXTENSIONS:
        path = out_dir / f"{texture.get_name()}{extension}"
        if export_object(texture, path):
            return {"file": path.name, **texture_info(texture)}
    raise RuntimeError(f"No exporter wrote {texture.get_path_name()}")


def related_assets(package_paths: list[str]) -> set[str]:
    """Meshes and textures the given packages depend on inside the plugin."""
    registry = inventory.registry()
    options = unreal.AssetRegistryDependencyOptions(
        include_soft_package_references=True,
        include_hard_package_references=True,
    )
    found: set[str] = set()
    for package in package_paths:
        for dependency in registry.get_dependencies(package, options) or []:
            name = str(dependency)
            if name.startswith(PLUGIN_PREFIX):
                found.add(name)
    return found


def assets_in_packages(packages: set[str], classes: set[str]) -> list[unreal.AssetData]:
    registry = inventory.registry()
    result = []
    for package in sorted(packages):
        for asset in registry.get_assets_by_package_name(package) or []:
            if inventory.class_name(asset) in classes:
                result.append(asset)
    return result


def export_style(slot: str, style_path: str, work: Path) -> dict[str, Any]:
    style = style_path.rsplit("/", 1)[-1]
    own = inventory.assets_under(style_path)
    own_packages = {str(asset.package_name) for asset in own}
    # Bindings/<slot> holds "<style>_Binding" and the wardrobe item "WI_<style>".
    binding_names = {f"{style}_Binding", f"WI_{style}"}
    binding_packages = {
        str(asset.package_name)
        for asset in inventory.assets_under(f"{BINDINGS}/{slot}")
        if str(asset.asset_name) in binding_names
    }
    linked = related_assets(sorted(own_packages | binding_packages)) - own_packages

    meshes: dict[str, str] = {}
    for asset in [a for a in own if inventory.class_name(a) in MESH_CLASSES]:
        mesh = asset.get_asset()
        path = work / "meshes" / f"{asset.asset_name}.fbx"
        if not export_object(mesh, path, fbx_options()):
            raise RuntimeError(f"FBX export failed for {asset.package_name}")
        meshes[str(asset.asset_name)] = path.relative_to(work).as_posix()

    textures: dict[str, Any] = {}
    texture_assets = [a for a in own if inventory.class_name(a) in TEXTURE_CLASSES]
    texture_assets += assets_in_packages(linked, TEXTURE_CLASSES)
    for asset in texture_assets:
        textures[str(asset.package_name)] = export_texture(asset.get_asset(), work / "textures")

    grooms = {
        inventory.object_path(a): ue.dump_properties(a.get_asset())
        for a in own
        if inventory.class_name(a) == "GroomAsset"
    }
    bindings = {
        inventory.object_path(a): ue.dump_properties(a.get_asset())
        for package in sorted(binding_packages)
        for a in inventory.registry().get_assets_by_package_name(package) or []
    }
    write_json(
        work / "cards.json",
        {
            "slot": slot,
            "style": style,
            "style_path": style_path,
            "meshes": meshes,
            "textures": textures,
            "grooms": grooms,
            "bindings": bindings,
            "other_assets": {
                inventory.object_path(a): inventory.class_name(a)
                for a in own
                if inventory.class_name(a) not in MESH_CLASSES | TEXTURE_CLASSES
            },
        },
    )
    return {"slot": slot, "style": style, "meshes": len(meshes), "textures": len(textures)}


def export_groom_head(work: Path) -> dict[str, Any]:
    exported = []
    for asset in inventory.assets_under(GROOM_HEAD):
        if inventory.class_name(asset) in MESH_CLASSES:
            path = work / f"{asset.asset_name}.fbx"
            if not export_object(asset.get_asset(), path, fbx_options()):
                raise RuntimeError(f"FBX export failed for {asset.package_name}")
            exported.append(path.name)
    if not exported:
        raise RuntimeError(f"No groom head mesh under {GROOM_HEAD}")
    return {"meshes": exported}


def export_eyelash_textures(work: Path) -> dict[str, Any]:
    """Eyelash grooms ship strands only; the card look comes from these maps,
    which the head's eyelash material uses rather than the groom itself."""
    textures = {
        str(a.package_name): export_texture(a.get_asset(), work)
        for a in inventory.assets_under(EYELASH_TEXTURES)
        if inventory.class_name(a) in TEXTURE_CLASSES
    }
    if not textures:
        raise RuntimeError(f"No textures under {EYELASH_TEXTURES}")
    write_json(work / "textures.json", textures)
    return {"textures": len(textures)}


def style_folders() -> list[tuple[str, str]]:
    """(slot, style content path) for every style folder, sorted."""
    registry = inventory.registry()
    folders = []
    for slot_path in sorted(str(p) for p in registry.get_sub_paths(GROOM_ASSETS, False)):
        slot = slot_path.rsplit("/", 1)[-1]
        for style_path in sorted(str(p) for p in registry.get_sub_paths(slot_path, False)):
            folders.append((slot, style_path))
    return folders


def run(archive: Archive, args: dict[str, Any]) -> dict[str, Any]:
    """Args: slots (list, default all), only (list of style names), force."""
    inventory.scan((GROOMS_ROOT,))
    slots = set(args.get("slots") or [])
    only = set(args.get("only") or [])
    inventory.scan((EYELASH_TEXTURES,))
    units = [
        Unit("grooms/_groom_head", archive.unit_dir("grooms", "_groom_head"), export_groom_head),
        Unit(
            "grooms/_eyelash_textures",
            archive.unit_dir("grooms", "_eyelash_textures"),
            export_eyelash_textures,
        ),
    ]
    for slot, style_path in style_folders():
        style = style_path.rsplit("/", 1)[-1]
        if (slots and slot not in slots) or (only and style not in only):
            continue
        units.append(
            Unit(
                name=f"grooms/{slot}/{style}",
                directory=archive.unit_dir("grooms", slot, style),
                export=lambda work, slot=slot, style_path=style_path: export_style(
                    slot, style_path, work
                ),
            )
        )
    log = JobLog(archive.logs, "grooms")
    summary = run_units(units, log, force=bool(args.get("force")), skip=SkipList(archive.skip_file))
    return {"units": len(units), "log": str(log.path), **summary.as_dict()}
