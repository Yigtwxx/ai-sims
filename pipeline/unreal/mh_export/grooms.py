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
from mh_export.exporters import export_gltf, export_object, export_texture, fbx_options

GROOMS_ROOT = "/MetaHumanCharacter/Optional/Grooms"
GROOM_ASSETS = f"{GROOMS_ROOT}/GroomAssets"
BINDINGS = f"{GROOMS_ROOT}/Bindings"
GROOM_HEAD = f"{GROOMS_ROOT}/GroomMesh"
EYELASH_TEXTURES = "/MetaHumanCharacter/Textures/Eyelashes"
PLUGIN_PREFIX = "/MetaHumanCharacter/"
MESH_CLASSES = {"StaticMesh", "SkeletalMesh"}
TEXTURE_CLASSES = {"Texture2D"}
FAB_ROOT = "/Game/Fab"  # fab_import puts each .mhpkg in /Game/Fab/<package>
FAB_BINDING_CLASSES = {"GroomBindingAsset", "MetaHumanWardrobeItem"}
FAB_SLOT = "Hair"  # the Fab groom packages we take are all hairstyles


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


def export_style(
    slot: str, style_path: str, work: Path, style: str | None = None
) -> dict[str, Any]:
    """`style` is given for Fab packages, whose folder is named after the package."""
    fab = style is not None
    style = style or style_path.rsplit("/", 1)[-1]
    own = inventory.assets_under(style_path)
    own_packages = {str(asset.package_name) for asset in own}
    if fab:
        # A Fab package keeps its binding and wardrobe item next to the groom.
        binding_packages = {
            str(asset.package_name)
            for asset in own
            if inventory.class_name(asset) in FAB_BINDING_CLASSES
        }
    else:
        # Bindings/<slot> holds "<style>_Binding" and the wardrobe item "WI_<style>".
        binding_names = {f"{style}_Binding", f"WI_{style}"}
        binding_packages = {
            str(asset.package_name)
            for asset in inventory.assets_under(f"{BINDINGS}/{slot}")
            if str(asset.asset_name) in binding_names
        }
    linked = related_assets(sorted(own_packages | binding_packages)) - own_packages

    meshes: dict[str, dict[str, str]] = {}
    for asset in [a for a in own if inventory.class_name(a) in MESH_CLASSES]:
        meshes[str(asset.asset_name)] = export_mesh(asset, work / "meshes", work)

    textures: dict[str, Any] = {}
    texture_assets = [a for a in own if inventory.class_name(a) in TEXTURE_CLASSES]
    texture_assets += assets_in_packages(linked, TEXTURE_CLASSES)
    skipped_textures: dict[str, str] = {}
    for asset in texture_assets:
        try:
            textures[str(asset.package_name)] = export_texture(asset.get_asset(), work / "textures")
        except RuntimeError as error:
            # Fab packages carry helper textures (T_Black_Linear) some exporters refuse;
            # the converter reports a missing card atlas on its own.
            if not fab or "atlas" in str(asset.asset_name).lower():
                raise
            skipped_textures[str(asset.package_name)] = str(error)

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
            "skipped_textures": skipped_textures,
            "other_assets": {
                inventory.object_path(a): inventory.class_name(a)
                for a in own
                if inventory.class_name(a) not in MESH_CLASSES | TEXTURE_CLASSES
            },
        },
    )
    return {"slot": slot, "style": style, "meshes": len(meshes), "textures": len(textures)}


def export_mesh(asset: unreal.AssetData, out_dir: Path, work: Path) -> dict[str, str]:
    """GLB (what the converter reads) plus FBX (archival); both must succeed."""
    mesh = asset.get_asset()
    glb = out_dir / f"{asset.asset_name}.glb"
    fbx = out_dir / f"{asset.asset_name}.fbx"
    if not export_gltf(mesh, glb):
        raise RuntimeError(f"glTF export failed for {asset.package_name}")
    if not export_object(mesh, fbx, fbx_options()):
        raise RuntimeError(f"FBX export failed for {asset.package_name}")
    return {"glb": glb.relative_to(work).as_posix(), "fbx": fbx.relative_to(work).as_posix()}


def export_groom_head(work: Path) -> dict[str, Any]:
    exported = []
    for asset in inventory.assets_under(GROOM_HEAD):
        if inventory.class_name(asset) in MESH_CLASSES:
            exported.append(export_mesh(asset, work, work))
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


def fab_styles() -> list[tuple[str, str, str]]:
    """(slot, package folder, style) for Fab packages holding a groom and its wardrobe item.
    The style is the wardrobe item's name without `WI_`; character packages (whose own
    groom we do not take) are left out."""
    inventory.scan((FAB_ROOT,))
    registry = inventory.registry()
    styles = []
    for folder in sorted(str(p) for p in registry.get_sub_paths(FAB_ROOT, False)):
        classes: dict[str, list[str]] = {}
        for asset in inventory.assets_under(folder):
            classes.setdefault(inventory.class_name(asset), []).append(str(asset.asset_name))
        if "MetaHumanCharacter" in classes or "GroomAsset" not in classes:
            continue
        items = [n for n in classes.get("MetaHumanWardrobeItem", []) if n.startswith("WI_")]
        if len(items) == 1:
            styles.append((FAB_SLOT, folder, items[0].removeprefix("WI_")))
    return styles


def run(archive: Archive, args: dict[str, Any]) -> dict[str, Any]:
    """Args: slots (list, default all), only (list of style names), fab (Fab packages,
    default true), force.

    With `only`, `force` re-exports the listed styles alone: the shared groom head and
    eyelash units are still exported when missing, but not again (a new groom head
    `done.json` would make the converter rebuild every groom)."""
    inventory.scan((GROOMS_ROOT,))
    slots = set(args.get("slots") or [])
    only = set(args.get("only") or [])
    force = bool(args.get("force"))
    inventory.scan((EYELASH_TEXTURES,))
    shared = [
        Unit("grooms/_groom_head", archive.unit_dir("grooms", "_groom_head"), export_groom_head),
        Unit(
            "grooms/_eyelash_textures",
            archive.unit_dir("grooms", "_eyelash_textures"),
            export_eyelash_textures,
        ),
    ]
    units: list[Unit] = []
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
    for slot, folder, style in fab_styles() if args.get("fab", True) else []:
        if (slots and slot not in slots) or (only and style not in only):
            continue
        units.append(
            Unit(
                name=f"grooms/{slot}/{style}",
                directory=archive.unit_dir("grooms", slot, style),
                export=lambda work, slot=slot, folder=folder, style=style: export_style(
                    slot, folder, work, style
                ),
            )
        )
    log = JobLog(archive.logs, "grooms")
    skip = SkipList(archive.skip_file)
    head = run_units(shared, log, force=force and not only, skip=skip)
    summary = run_units(units, log, force=force, skip=skip)
    for name in ("done", "skipped", "excluded", "deferred"):
        getattr(summary, name)[:0] = getattr(head, name)
    summary.failed = {**head.failed, **summary.failed}
    return {"units": len(shared) + len(units), "log": str(log.path), **summary.as_dict()}
