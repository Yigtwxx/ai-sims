"""Named export jobs the launcher can run inside the editor."""

from __future__ import annotations

import importlib
from collections.abc import Callable
from typing import Any

from mh_export.archive import Archive

Job = Callable[[Archive, dict[str, Any]], dict[str, Any]]


def _inventory(archive: Archive, args: dict[str, Any]) -> dict[str, Any]:
    from mh_export import inventory

    return {"counts": inventory.run(archive)["counts"]}


def _arkit(archive: Archive, args: dict[str, Any]) -> dict[str, Any]:
    from mh_export import arkit

    mapping = arkit.run(archive)
    return {"poses": len(mapping["pose_names"]), "curves": len(mapping["curves"])}


def _module_job(module: str) -> Job:
    """Jobs whose module exposes `run(archive, args)`; imported lazily inside the editor."""

    def job(archive: Archive, args: dict[str, Any]) -> dict[str, Any]:
        return importlib.import_module(f"mh_export.{module}").run(archive, args)

    return job


JOBS: dict[str, Job] = {
    "inventory": _inventory,
    "arkit": _arkit,
    **{
        name: _module_job(name)
        for name in (
            "characters",
            "grooms",
            "statics",
            "animations",
            "lighting",
            "materials",
            "wardrobe",
            "fab_import",
            "bodies",
            "probe",
        )
    },
}


def get(name: str) -> Job:
    if name not in JOBS:
        raise KeyError(f"Unknown job {name!r}; known: {', '.join(sorted(JOBS))}")
    return JOBS[name]
