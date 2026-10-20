"""Probe: slot selection API of a character's internal collection."""

# ruff: noqa: F821  (unreal, report are injected by mh_export.probe)
from mh_export import ue

character = unreal.load_asset("/Game/MHExport/Scratch/OutfitProbe.OutfitProbe")
collection = character.internal_collection
instance = collection.default_instance
report["collection_methods"] = sorted(m for m in dir(collection) if not m.startswith("_"))
report["instance_methods"] = sorted(m for m in dir(instance) if not m.startswith("_"))
report["instance_props"] = ue.editor_property_names(instance)
report["collection_props"] = ue.editor_property_names(collection)
for name in report["instance_props"]:
    try:
        report[f"instance.{name}"] = ue.to_text(instance.get_editor_property(name))
    except Exception as exc:
        report[f"instance.{name}"] = repr(exc)
