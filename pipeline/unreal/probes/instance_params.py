"""Probe: how to read wardrobe instance parameters (hair melanin, outfit colours) in 5.8.

The wardrobe job reads `get_instance_parameters(item_path=PaletteItemPath(item_key))`
after `assemble_for_preview` and always gets an empty list. This tries the other
entry points on the instance and reports what each returns.
"""

# ruff: noqa: F821  (unreal, report are injected by mh_export.probe)
from mh_export import ue

SCRATCH = "/Game/MHExport/Scratch/WardrobeProbe.WardrobeProbe"
HAIR = "/MetaHumanCharacter/Optional/Grooms/Bindings/Hair/WI_Hair_S_Coil.WI_Hair_S_Coil"

character = unreal.load_asset(SCRATCH)
collection = character.internal_collection
instance = collection.default_instance
for name in (
    "assemble",
    "get_instance_parameter_item_paths",
    "get_instance_parameters",
    "try_get_instance_parameter",
    "get_assembly_output",
    "is_assembled",
):
    report[f"doc.{name}"] = (getattr(instance, name).__doc__ or "")[:1200]
report["doc.assemble_for_preview"] = (ue.subsystem().assemble_for_preview.__doc__ or "")[:1200]

item = unreal.load_asset(HAIR)
with ue.editing(character):
    key = ue.palette_key(character, "Hair", item)
    ue.select_only(character, "Hair", key)
    report["paths_before"] = ue.to_text(instance.get_instance_parameter_item_paths())
    try:
        ue.subsystem().assemble_for_preview(character=character)
        report["assembled_after_preview"] = bool(instance.is_assembled())
    except Exception as exc:
        report["preview_error"] = repr(exc)[:500]
    report["paths_after_preview"] = ue.to_text(instance.get_instance_parameter_item_paths())
    for i, path in enumerate(instance.get_instance_parameter_item_paths()):
        params = instance.get_instance_parameters(item_path=path)
        report[f"params_{i}"] = [ue.dump_properties(p) for p in params][:20]
        report[f"params_{i}_names"] = [str(getattr(p, "name", "")) for p in params]
    by_key = instance.get_instance_parameters(
        item_path=unreal.MetaHumanPaletteItemPath(item_key=key)
    )
    report["params_by_key"] = len(by_key)
    ue.select_only(character, "Hair")
