"""Count every MetaHuman asset by class so the export knows what really ships in 5.8.

Optional plugin content is not indexed when the editor starts, so the asset
registry is scanned synchronously first; without that, presets and grooms are
silently missing from queries.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

import unreal

from mh_export.archive import Archive, now_iso, write_json

CONTENT_ROOTS = ("/MetaHumanCharacter", "/MetaHumanCoreTech", "/MetaHuman", "/Game/MetaHumans")


def registry() -> unreal.AssetRegistry:
    return unreal.AssetRegistryHelpers.get_asset_registry()


def scan(roots: tuple[str, ...] = CONTENT_ROOTS) -> None:
    registry().scan_paths_synchronous(list(roots), True)


def class_name(asset: unreal.AssetData) -> str:
    return str(asset.asset_class_path.asset_name)


def object_path(asset: unreal.AssetData) -> str:
    return f"{asset.package_name}.{asset.asset_name}"


def assets_under(root: str) -> list[unreal.AssetData]:
    return list(registry().get_assets_by_path(root, recursive=True))


def find_assets(class_names: set[str], roots: tuple[str, ...] = CONTENT_ROOTS) -> list[str]:
    """Object paths of every asset of the given classes, sorted for stable runs."""
    found = {
        object_path(asset)
        for root in roots
        for asset in assets_under(root)
        if class_name(asset) in class_names
    }
    return sorted(found)


def find_by_name(name: str, roots: tuple[str, ...] = CONTENT_ROOTS) -> list[str]:
    return sorted(
        {object_path(a) for root in roots for a in assets_under(root) if str(a.asset_name) == name}
    )


def collect(roots: tuple[str, ...] = CONTENT_ROOTS) -> dict[str, Any]:
    scan(roots)
    by_class: dict[str, list[str]] = defaultdict(list)
    for root in roots:
        for asset in assets_under(root):
            by_class[class_name(asset)].append(object_path(asset))
    classes = {name: sorted(set(paths)) for name, paths in sorted(by_class.items())}
    return {
        "created_at": now_iso(),
        "engine_version": unreal.SystemLibrary.get_engine_version(),
        "roots": list(roots),
        "mounted_roots": sorted(str(p) for p in registry().get_sub_paths("/", False)),
        "counts": {name: len(paths) for name, paths in classes.items()},
        "classes": classes,
    }


def run(archive: Archive) -> dict[str, Any]:
    inventory = collect()
    write_json(archive.raw / "inventory.json", inventory)
    unreal.log(f"[mh_export] inventory: {sum(inventory['counts'].values())} assets")
    return inventory
