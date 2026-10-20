"""Export every texture and reference mesh the MetaHuman materials and rigs use.

DCC Export only carries a character's synthesized skin. Eyes, teeth, eyelashes,
micro-detail normals, makeup and freckle masks, lighting cubemaps and the body
texture library live in the plugin as ordinary assets; the web shaders need all
of them, so they are exported once here, grouped by folder so a run can resume.
Groom textures are left to the grooms job.
"""

from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Any

import unreal

from mh_export import inventory
from mh_export.archive import Archive, JobLog, SkipList, Unit, run_units, write_json
from mh_export.exporters import export_gltf, export_object, export_texture, fbx_options

ROOTS = ("/MetaHumanCharacter", "/MetaHuman")
SKIP_PREFIXES = ("/MetaHumanCharacter/Optional/Grooms/",)
TEXTURE_CLASSES = {"Texture2D", "TextureCube", "Texture2DArray"}
MESH_CLASSES = {"SkeletalMesh", "StaticMesh"}
GROUP_DEPTH = 4  # "/MetaHumanCharacter/Lookdev_UHM/Eye" style groups
# Meshes of the default garment (Chaos Cloth "<garment>_CombinedSkelMesh" and the
# cloth source bodies) crash the editor inside the exporter with an array
# assertion, which Python cannot catch, so they are listed and skipped. Their
# textures are still exported; outfits come from the outfits job, which exports
# the built meshes.
UNEXPORTABLE_MESH_PREFIXES = ("/MetaHumanCharacter/Optional/Clothing/",)
UNEXPORTABLE_MESH_SUFFIXES = ("_CombinedSkelMesh",)


def exportable_mesh(package: str, name: str) -> bool:
    return not package.startswith(UNEXPORTABLE_MESH_PREFIXES) and not name.endswith(
        UNEXPORTABLE_MESH_SUFFIXES
    )


def group_of(package_path: str) -> str:
    """Folder group a package belongs to, e.g. /MetaHumanCharacter/Lookdev_UHM/Eye."""
    parts = package_path.split("/")
    return "/".join(parts[:GROUP_DEPTH]) if len(parts) > GROUP_DEPTH else "/".join(parts[:-1])


def collect_groups() -> dict[str, list[unreal.AssetData]]:
    inventory.scan(ROOTS)
    groups: dict[str, list[unreal.AssetData]] = defaultdict(list)
    for root in ROOTS:
        for asset in inventory.assets_under(root):
            package = str(asset.package_name)
            if package.startswith(SKIP_PREFIXES):
                continue
            if inventory.class_name(asset) in TEXTURE_CLASSES | MESH_CLASSES:
                groups[group_of(package)].append(asset)
    return dict(sorted(groups.items()))


def relative_dir(group: str, package: str) -> Path:
    rel = package[len(group) :].strip("/")
    return Path(*rel.split("/")[:-1]) if "/" in rel else Path()


def export_group(group: str, assets: list[unreal.AssetData], work: Path) -> dict[str, Any]:
    textures: dict[str, Any] = {}
    meshes: dict[str, Any] = {}
    failures: dict[str, str] = {}
    skipped: list[str] = []
    for asset in sorted(assets, key=lambda a: str(a.package_name)):
        package = str(asset.package_name)
        target = work / relative_dir(group, package)
        is_mesh = inventory.class_name(asset) in MESH_CLASSES
        if is_mesh and not exportable_mesh(package, str(asset.asset_name)):
            skipped.append(package)
            continue
        try:
            obj = asset.get_asset()
            if inventory.class_name(asset) in TEXTURE_CLASSES:
                info = export_texture(obj, target)
                info["file"] = (relative_dir(group, package) / info["file"]).as_posix()
                textures[package] = info
            else:
                fbx = target / f"{asset.asset_name}.fbx"
                entry: dict[str, Any] = {"class": inventory.class_name(asset)}
                if export_object(obj, fbx, fbx_options()):
                    entry["fbx"] = fbx.relative_to(work).as_posix()
                glb = target / f"{asset.asset_name}.glb"
                if export_gltf(obj, glb):
                    entry["glb"] = glb.relative_to(work).as_posix()
                if len(entry) == 1:
                    raise RuntimeError("no exporter wrote the mesh")
                meshes[package] = entry
        except Exception as exc:
            failures[package] = f"{type(exc).__name__}: {exc}"
    write_json(
        work / "statics.json",
        {
            "group": group,
            "textures": textures,
            "meshes": meshes,
            "failures": failures,
            "skipped": skipped,
        },
    )
    if not textures and not meshes and not only_trivial_failures(failures):
        raise RuntimeError(f"Nothing exported for {group}: {failures}")
    return {
        "textures": len(textures),
        "meshes": len(meshes),
        "failures": len(failures),
        "skipped": len(skipped),
    }


def only_trivial_failures(failures: dict[str, str]) -> bool:
    """True when every failure is a texture no exporter can write (e.g. the constant
    T_Black_Linear, which has no source art); a group of only those is complete."""
    return bool(failures) and all(
        "No exporter wrote" in error and package.rsplit("/", 1)[-1].startswith("T_")
        for package, error in failures.items()
    )


def run(archive: Archive, args: dict[str, Any]) -> dict[str, Any]:
    """Args: only (list of group paths), force."""
    only = set(args.get("only") or [])
    groups = {g: a for g, a in collect_groups().items() if not only or g in only}
    units = [
        Unit(
            name=f"statics{group}",
            directory=archive.unit_dir("statics", *group.strip("/").split("/")),
            export=lambda work, group=group, assets=assets: export_group(group, assets, work),
        )
        for group, assets in groups.items()
    ]
    log = JobLog(archive.logs, "statics")
    summary = run_units(units, log, force=bool(args.get("force")), skip=SkipList(archive.skip_file))
    return {"groups": len(units), "log": str(log.path), **summary.as_dict()}
