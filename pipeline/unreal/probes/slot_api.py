"""Probe: signatures of the slot selection API (UE 5.8 MetaHumanInstance/Collection)."""

# ruff: noqa: F821  (unreal, report are injected by mh_export.probe)
from mh_export import ue

character = unreal.load_asset("/Game/MHExport/Scratch/OutfitProbe.OutfitProbe")
collection = character.internal_collection
instance = collection.default_instance
for owner, names in (
    (instance, ["set_single_slot_selection", "get_slot_selection_data", "try_add_slot_selection"]),
    (collection, ["get_item_keys_for_slot", "get_item_keys_for_wardrobe_item", "get_slot_names"]),
):
    for name in names:
        report[f"doc.{name}"] = (getattr(owner, name).__doc__ or "")[:1500]
report["slot_names"] = [str(s) for s in collection.get_slot_names()]
report["outfit_keys"] = [ue.to_text(k) for k in collection.get_item_keys_for_slot("Outfits")]
data = instance.get_slot_selection_data()
report["selection_data_type"] = type(data).__name__
report["selection_data"] = ue.to_text(data)[:3000]
