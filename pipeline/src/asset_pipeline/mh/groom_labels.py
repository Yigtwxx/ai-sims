"""Bilingual labels for groom styles (hair, brows, beards, moustaches).

Unreal gives a groom one English thumbnail name, often awkward ("Medium Bob Straight") and
sometimes with the wrong size. groom_labels.json maps each style (`Hair_S_Pixie`) to a short
catalogue label in Turkish and English; the manifest builder reads it at manifest time, so
a changed label needs no reconversion. A style it does not list keeps its converter label.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

LABELS_FILE = Path(__file__).with_name("groom_labels.json")  # {style: {en, tr}}


def groom_labels(labels_file: Path = LABELS_FILE) -> dict[str, dict[str, str]]:
    """Every curated label, keyed by style; a malformed entry is an error, not a fallback."""
    data = json.loads(labels_file.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{labels_file.name}: expected an object of styles")
    for style, label in data.items():
        if not (
            isinstance(label, dict)
            and isinstance(label.get("tr"), str)
            and isinstance(label.get("en"), str)
            and label["tr"].strip()
            and label["en"].strip()
        ):
            raise ValueError(f"{labels_file.name}: {style} needs non-empty tr and en labels")
    return {style: {"tr": label["tr"], "en": label["en"]} for style, label in data.items()}


def with_label(groom: dict[str, Any], labels_file: Path = LABELS_FILE) -> dict[str, Any]:
    """The groom entry with its curated {tr, en} label (`groom.hair.Hair_S_Pixie` ->
    `Hair_S_Pixie`), or unchanged when the style is not listed."""
    label = groom_labels(labels_file).get(str(groom["id"]).split(".", 2)[-1])
    return {**groom, "label": label} if label else groom
