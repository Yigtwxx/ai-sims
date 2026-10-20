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
