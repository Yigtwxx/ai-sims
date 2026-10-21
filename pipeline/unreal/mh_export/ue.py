"""Small helpers around the `unreal` module shared by the export jobs."""

from __future__ import annotations

import re
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import unreal

_EDITOR_PROPERTY = re.compile(r"^\s*-\s+``(\w+)``\s+\(([^)]*)\)")


def subsystem() -> unreal.MetaHumanCharacterEditorSubsystem:
    return unreal.get_editor_subsystem(unreal.MetaHumanCharacterEditorSubsystem)


@contextmanager
def editing(character: unreal.MetaHumanCharacter) -> Iterator[unreal.MetaHumanCharacter]:
    """Open a character for editing in the MetaHuman subsystem for the scope."""
    mh = subsystem()
    if not mh.try_add_object_to_edit(character):
        raise RuntimeError(f"Cannot edit {character.get_path_name()}; is it open elsewhere?")
    try:
        yield character
    finally:
        if mh.is_object_added_for_editing(character):
            mh.remove_object_to_edit(character)


def editor_property_names(obj: object) -> list[str]:
    """Editor property names, read from the generated class docstring."""
    names = []
    for line in (type(obj).__doc__ or "").splitlines():
        match = _EDITOR_PROPERTY.match(line)
        if match:
            names.append(match.group(1))
    return names


def to_text(value: object) -> object:
    """JSON-friendly form of an Unreal value: structs as their exported text."""
    if value is None or isinstance(value, bool | int | float | str):
        return value
    if isinstance(value, list | tuple | unreal.Array):
        return [to_text(item) for item in value]
    if hasattr(value, "export_text"):
        return value.export_text()
    if hasattr(value, "get_path_name"):
        return value.get_path_name()
    return str(value)


def dump_properties(obj: object, names: list[str] | None = None) -> dict[str, Any]:
    """Every readable editor property of `obj`, skipping the ones that fail."""
    result: dict[str, Any] = {}
    for name in names or editor_property_names(obj):
        try:
            result[name] = to_text(obj.get_editor_property(name))
        except Exception as exc:
            result[name] = {"error": f"{type(exc).__name__}: {exc}"}
    return result


def ensure_directory(content_path: str) -> None:
    if not unreal.EditorAssetLibrary.does_directory_exist(content_path):
        unreal.EditorAssetLibrary.make_directory(content_path)


def duplicate(source: str, destination: str) -> unreal.Object:
    """Copy an asset into the project once; later runs reuse the copy."""
    if not unreal.EditorAssetLibrary.does_asset_exist(destination):
        ensure_directory(destination.rsplit("/", 1)[0])
        if unreal.EditorAssetLibrary.duplicate_asset(source, destination) is None:
            raise RuntimeError(f"Could not duplicate {source} to {destination}")
    asset = unreal.load_asset(destination)
    if asset is None:
        raise RuntimeError(f"Could not load {destination}")
    return asset


# --------------------------------------------------------------------- wardrobe

_PRINCIPAL_ASSET = re.compile(r'Asset="([^"]+)"')
GROOM_SLOTS = ("Eyebrows", "Eyelashes", "Peachfuzz", "Mustache", "Beard", "Hair")


def principal_asset_path(item: unreal.MetaHumanWardrobeItem) -> str | None:
    """Object path of the asset a wardrobe item wraps (groom binding, outfit, ...)."""
    match = _PRINCIPAL_ASSET.search(str(to_text(item.get_editor_property("principal_asset"))))
    return match.group(1) if match else None


def groom_slot(item: unreal.MetaHumanWardrobeItem) -> str | None:
    """The groom slot of an item that wraps a groom binding, else None (an outfit).

    Fab grooms do not live under a .../Bindings/<Slot>/ folder, so the slot comes
    from the wrapped asset's class and the item name.
    """
    path = principal_asset_path(item)
    if not path:
        return None
    data = unreal.EditorAssetLibrary.find_asset_data(path)
    cls = str(data.asset_class_path.asset_name) if data.is_valid() else ""
    if "Groom" not in cls and not path.rsplit("/", 1)[-1].startswith("GB_"):
        return None
    name = item.get_name()
    return next((slot for slot in GROOM_SLOTS if slot in name), "Hair")


def palette_key(
    character: unreal.MetaHumanCharacter, slot: str, item: unreal.MetaHumanWardrobeItem
) -> unreal.MetaHumanPaletteItemKey:
    """The character's palette key for `item`, adding the item only the first time.

    UE 5.8 has no API to remove palette items, so re-adding on every use would
    grow the character (and the editor's memory) without bound.
    """
    collection = character.internal_collection
    keys = collection.get_item_keys_for_wardrobe_item(item)
    if keys:
        return keys[0]
    key = collection.try_add_item_from_wardrobe_item(slot, item)
    if not key:
        raise RuntimeError(f"{item.get_path_name()} could not be added to the {slot} slot")
    return key


def select_only(
    character: unreal.MetaHumanCharacter,
    slot: str,
    key: unreal.MetaHumanPaletteItemKey | None = None,
) -> None:
    """Select exactly `key` in `slot`, or nothing when `key` is None."""
    instance = character.internal_collection.default_instance
    instance.set_single_slot_selection(slot, key or unreal.MetaHumanPaletteItemKey())
