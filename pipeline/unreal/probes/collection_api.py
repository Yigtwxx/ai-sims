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
for name in report["collection_props"]:
    try:
        report[f"collection.{name}"] = ue.to_text(collection.get_editor_property(name))[:3000]
    except Exception as exc:
        report[f"collection.{name}"] = repr(exc)
item = unreal.load_asset("/Game/Fab/hair_m_bantuknots/WI_Hair_M_BantuKnots.WI_Hair_M_BantuKnots")
if item:
    report["item_props"] = ue.editor_property_names(item)
    report["principal_text"] = ue.to_text(item.get_editor_property("principal_asset"))
    report["groom_slot"] = ue.groom_slot(item)
