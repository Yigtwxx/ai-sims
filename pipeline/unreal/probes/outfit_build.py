"""Probe: what does build_meta_human produce for a character wearing an outfit?

Self-contained: copies a preset, rigs it and fetches 2K textures (enough to
build), saves it, then sets the neutral female body, adds the default garment
and builds. Reports rig state after the body edit and every asset the build made.
"""

# ruff: noqa: F821  (unreal, report are injected by mh_export.probe)
from mh_export import bodies, characters, inventory, ue

PRESET = "/MetaHumanCharacter/Optional/Presets/Ada.Ada"
COPY = "/Game/MHExport/Scratch/OutfitProbe.OutfitProbe"
BUILD = "/Game/MHExport/Builds/OutfitProbe"
GARMENT = "/MetaHumanCharacter/Optional/Clothing/WI_DefaultGarment.WI_DefaultGarment"

sub = ue.subsystem()
character = ue.duplicate(PRESET, COPY)
with ue.editing(character):
    characters.request_resolution(character, "res2k", "res2k")
    characters.rig(character)
    characters.download_textures(character)
    report["can_build_before_body_edit"] = bool(sub.can_build_meta_human(character=character))
    bodies.apply(character, {**bodies.GENDERS["female"], **bodies.NEUTRAL_SHAPE})
    report["can_build_after_body_edit"] = bool(sub.can_build_meta_human(character=character))
    if not report["can_build_after_body_edit"]:
        characters.rig(character)
        report["can_build_after_rerig"] = bool(sub.can_build_meta_human(character=character))
    collection = character.internal_collection
    key = collection.try_add_item_from_wardrobe_item("Outfits", unreal.load_asset(GARMENT))
    selection = unreal.MetaHumanPipelineSlotSelection(slot_name="Outfits", selected_item=key)
    report["selection_added"] = bool(collection.default_instance.try_add_slot_selection(selection))
    params = unreal.MetaHumanCharacterEditorBuildParameters()
    report["build_param_fields"] = ue.editor_property_names(params)
    report["pipeline_types"] = [n for n in dir(unreal.MetaHumanDefaultPipelineType) if n.isupper()]
    report["quality_levels"] = [n for n in dir(unreal.MetaHumanQualityLevel) if n.isupper()]
    params.pipeline_type = unreal.MetaHumanDefaultPipelineType.OPTIMIZED
    params.pipeline_quality = unreal.MetaHumanQualityLevel.HIGH
    params.absolute_build_path = BUILD
    params.common_folder_path = f"{BUILD}/Common"
    params.enable_wardrobe_item_validation = False
    try:
        sub.build_meta_human(character=character, params=params)
        report["build_error"] = None
    except Exception as exc:  # control rig copy warnings surface as exceptions
        report["build_error"] = str(exc)[:2000]
unreal.EditorAssetLibrary.save_loaded_asset(character, False)
inventory.scan((BUILD,))
report["built_assets"] = {
    inventory.object_path(a): inventory.class_name(a) for a in inventory.assets_under(BUILD)
}
