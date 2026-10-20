"""Import Fab MetaHuman packages (.mhpkg) into the export project.

The MetaHuman package factory registers the .mhpkg extension, so an automated
AssetImportTask brings in outfits, grooms and character assets without the
interactive import dialog. Each package is one resumable unit; its record lists
the assets the import created so later jobs can find them.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import unreal

from mh_export import inventory
from mh_export.archive import Archive, JobLog, SkipList, Unit, run_units, safe_name, write_json

DESTINATION = "/Game/Fab"


def package_files(fab_dir: Path) -> list[Path]:
    return sorted(fab_dir.rglob("*.mhpkg"))


def import_package(source: Path, work: Path) -> dict[str, Any]:
    before = {inventory.object_path(a) for a in inventory.assets_under("/Game")}
    task = unreal.AssetImportTask()
    task.filename = str(source)
    task.destination_path = f"{DESTINATION}/{safe_name(source.stem)}"
    task.automated = True
    task.replace_existing = True
    task.save = True
    factory = getattr(unreal, "MetaHumanPackageFactory", None)
    if factory is not None:
        task.factory = factory()
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    inventory.scan(("/Game",))
    after = {
        inventory.object_path(a): inventory.class_name(a) for a in inventory.assets_under("/Game")
    }
    created = {path: cls for path, cls in after.items() if path not in before}
    imported = [str(p) for p in task.get_editor_property("imported_object_paths")]
    if not created and not imported:
        raise RuntimeError(f"Import of {source.name} created no assets")
    write_json(
        work / "import.json",
        {
            "source": str(source),
            "bytes": source.stat().st_size,
            "imported_object_paths": imported,
            "created": created,
        },
    )
    return {"package": source.name, "created": len(created)}


def run(archive: Archive, args: dict[str, Any]) -> dict[str, Any]:
    """Args: dir (folder with .mhpkg files, default <archive>/fab), force."""
    fab_dir = Path(args.get("dir") or (archive.root / "fab"))
    units = [
        Unit(
            name=f"fab/{safe_name(path.stem)}",
            directory=archive.unit_dir("fab_import", path.stem),
            export=lambda work, path=path: import_package(path, work),
        )
        for path in package_files(fab_dir)
    ]
    if not units:
        raise RuntimeError(f"No .mhpkg files under {fab_dir}")
    log = JobLog(archive.logs, "fab_import")
    summary = run_units(units, log, force=bool(args.get("force")), skip=SkipList(archive.skip_file))
    return {"packages": len(units), "log": str(log.path), **summary.as_dict()}
