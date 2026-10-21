"""Dump every MetaHuman wardrobe item (grooms, outfits, Fab items) with its parameters.

Instance parameters (hair melanin and dye, outfit colours, ...) only exist once an
item is added to a character's collection, so each item is added to a scratch
copy of a preset, the character is assembled for preview, and the parameters
are read back. The web shaders expose the same parameters.
"""

from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Any

import unreal

from mh_export import characters, inventory, ue
from mh_export.archive import Archive, JobLog, SkipList, Unit, run_units, write_json

ROOTS = ("/MetaHumanCharacter", "/Game")
SCRATCH = "/Game/MHExport/Scratch/WardrobeProbe.WardrobeProbe"
# Folder under .../Bindings/<Folder>/ or Clothing -> pipeline slot name.
SLOTS = {
    "Hair": "Hair",
    "Eyebrows": "Eyebrows",
    "Beards": "Beard",
    "Mustaches": "Mustache",
    "Eyelashes": "Eyelashes",
    "Peachfuzz": "Peachfuzz",
    "Clothing": "Outfits",
}
VALUE_GETTERS = ("get_float", "get_color", "get_bool", "get_int", "get_texture", "get_value")


def slot_of(path: str) -> str:
    for folder, slot in SLOTS.items():
        if f"/{folder}/" in path:
            return slot
    return "Outfits"


def item_paths() -> dict[str, list[str]]:
    inventory.scan(ROOTS)
    by_slot: dict[str, list[str]] = defaultdict(list)
    for path in inventory.find_assets({"MetaHumanWardrobeItem"}, ROOTS):
        # Fab grooms are not under .../Bindings/<Slot>/; their wrapped asset tells.
        slot = slot_of(path)
        if slot == "Outfits":
            slot = ue.groom_slot(unreal.load_asset(path)) or slot
        by_slot[slot].append(path)
    return dict(sorted(by_slot.items()))


def scratch_character() -> unreal.MetaHumanCharacter:
    existing = unreal.load_asset(SCRATCH)
    if existing is not None:
        return existing
    preset = characters.preset_paths()[0]
    return ue.duplicate(preset, SCRATCH)


def param_record(param: object) -> dict[str, Any]:
    record: dict[str, Any] = {"name": str(getattr(param, "name", "")), **ue.dump_properties(param)}
    for getter in VALUE_GETTERS:
        fn = getattr(param, getter, None)
        if callable(fn):
            try:
                record[getter.removeprefix("get_")] = ue.to_text(fn())
            except Exception as exc:  # wrong type for this parameter
                record.setdefault("getter_errors", {})[getter] = type(exc).__name__
    return record


def probe_item(character: unreal.MetaHumanCharacter, slot: str, path: str) -> dict[str, Any]:
    item = unreal.load_asset(path)
    entry: dict[str, Any] = {"asset": path, "slot": slot, "properties": ue.dump_properties(item)}
    collection = character.internal_collection
    key = ue.palette_key(character, slot, item)
    ue.select_only(character, slot, key)
    try:
        ue.subsystem().assemble_for_preview(character=character)
        item_path = unreal.MetaHumanPaletteItemPath(item_key=key)
        params = collection.default_instance.get_instance_parameters(item_path=item_path)
        entry["parameters"] = [param_record(p) for p in params]
    finally:
        ue.select_only(character, slot)
    return entry


def export_slot(slot: str, paths: list[str], work: Path) -> dict[str, Any]:
    character = scratch_character()
    items = []
    with ue.editing(character):
        for path in paths:
            try:
                items.append(probe_item(character, slot, path))
            except Exception as exc:
                items.append({"asset": path, "slot": slot, "error": f"{type(exc).__name__}: {exc}"})
            # Each preview assembly loads the item's meshes and textures; without a
            # collection between items the Outfits slot ran the editor out of memory.
            unreal.SystemLibrary.collect_garbage()
    write_json(work / "wardrobe.json", {"slot": slot, "items": items})
    with_params = sum(1 for i in items if i.get("parameters"))
    return {"slot": slot, "items": len(items), "with_parameters": with_params}


def run(archive: Archive, args: dict[str, Any]) -> dict[str, Any]:
    """Args: only (slot names), force."""
    only = set(args.get("only") or [])
    units = [
        Unit(
            name=f"wardrobe/{slot}",
            directory=archive.unit_dir("wardrobe", slot),
            export=lambda work, slot=slot, paths=paths: export_slot(slot, paths, work),
        )
        for slot, paths in item_paths().items()
        if not only or slot in only
    ]
    log = JobLog(archive.logs, "wardrobe")
    summary = run_units(units, log, force=bool(args.get("force")), skip=SkipList(archive.skip_file))
    return {"slots": len(units), "log": str(log.path), **summary.as_dict()}
