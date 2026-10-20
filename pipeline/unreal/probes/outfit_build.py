"""Probe: what does build_meta_human produce for a character wearing an outfit?"""

# ruff: noqa: F821  (unreal, report are injected by mh_export.probe)
from mh_export import inventory, ue

SOURCE = "/Game/MHExport/Characters/Ada.Ada"  # rigged + textured by the characters job
COPY = "/Game/MHExport/Scratch/OutfitProbe.OutfitProbe"
BUILD = "/Game/MHExport/Builds/OutfitProbe"

character = ue.duplicate(SOURCE, COPY)
GARMENT = "/MetaHumanCharacter/Optional/Clothing/WI_DefaultGarment.WI_DefaultGarment"
item = unreal.load_asset(GARMENT)
collection = character.internal_collection
key = collection.try_add_item_from_wardrobe_item("Outfits", item)
report["item_key"] = str(key)
selection = unreal.MetaHumanPipelineSlotSelection(slot_name="Outfits", selected_item=key)
report["selection_added"] = bool(collection.default_instance.try_add_slot_selection(selection))
sub = ue.subsystem()
with ue.editing(character):
    report["can_build"] = bool(sub.can_build_meta_human(character=character))
    params = unreal.MetaHumanCharacterEditorBuildParameters()
    report["build_param_fields"] = ue.editor_property_names(params)
    report["pipeline_types"] = [n for n in dir(unreal.MetaHumanDefaultPipelineType) if n.isupper()]
    report["quality_levels"] = [n for n in dir(unreal.MetaHumanQualityLevel) if n.isupper()]
    params.pipeline_type = unreal.MetaHumanDefaultPipelineType.OPTIMIZED
    params.pipeline_quality = unreal.MetaHumanQualityLevel.HIGH
    params.absolute_build_path = BUILD
    params.common_folder_path = f"{BUILD}/Common"
    params.enable_wardrobe_item_validation = False
    sub.build_meta_human(character=character, params=params)
inventory.scan((BUILD,))
report["built_assets"] = {
    inventory.object_path(a): inventory.class_name(a) for a in inventory.assets_under(BUILD)
}
