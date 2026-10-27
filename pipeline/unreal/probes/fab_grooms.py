"""Probe: folder layout of the Fab hair packages (grooms, bindings, card meshes, textures).

Reads each package's import record, lists every asset under its /Game/Fab folder and
follows the groom and binding dependencies, so the grooms job can learn where Fab
packages keep their cards. Writes raw/fab_grooms_layout.json.
"""

# ruff: noqa: F821  (unreal, archive, report are injected by mh_export.probe)
import json

from mh_export import inventory, ue
from mh_export.archive import write_json

PACKAGES = (
    "hair_l_highponytail",
    "hair_f_ponytail_messywavy_01",
    "sc_hairstyle_male_11",
    "gb_nomadwaveundercut",
    "gb_ponytail",
    "mhc_frey",
)
GROOM_CLASSES = {"GroomAsset", "GroomBindingAsset", "MetaHumanWardrobeItem"}

options = unreal.AssetRegistryDependencyOptions(
    include_soft_package_references=True,
    include_hard_package_references=True,
)
registry = inventory.registry()
inventory.scan(("/Game/Fab",))
layout = {}
for package in PACKAGES:
    record = json.loads((archive.raw / "fab_import" / package / "import.json").read_text("utf-8"))
    folder = f"/Game/Fab/{package}"
    assets = {
        inventory.object_path(a): inventory.class_name(a) for a in inventory.assets_under(folder)
    }
    roots = set(record.get("imported_object_paths", []))
    roots |= {path for path, cls in assets.items() if cls in GROOM_CLASSES}
    dependencies = {}
    groom_props = {}
    for path in sorted(roots):
        package_name = path.split(".", 1)[0]
        dependencies[path] = sorted(
            str(d) for d in registry.get_dependencies(package_name, options) or []
        )
        asset = unreal.load_asset(path)
        if asset is None:
            continue
        cls = asset.get_class().get_name()
        if cls in ("GroomAsset", "GroomBindingAsset"):
            groom_props[path] = {"class": cls, "properties": ue.dump_properties(asset)}
    layout[package] = {
        "folder": folder,
        "assets": assets,
        "dependencies": dependencies,
        "grooms": groom_props,
    }
write_json(archive.raw / "fab_grooms_layout.json", layout)
report["packages"] = {
    name: {
        "assets": len(entry["assets"]),
        "classes": sorted(set(entry["assets"].values())),
        "outside_folder": sorted(
            {
                d
                for deps in entry["dependencies"].values()
                for d in deps
                if not d.startswith(entry["folder"])
            }
        ),
    }
    for name, entry in layout.items()
}
