"""Which gender the creator offers an item to, where Unreal does not say.

MetaHuman hair styles and garments carry no gender: every one is exported for both bodies.
gender_compat.json names the ones meant for one gender only (`female` or `male`); an item it
does not list keeps the compat the converter derived (unisex, facial hair male, a garment
with one mesh that mesh's gender).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

COMPAT_FILE = Path(__file__).with_name("gender_compat.json")  # {grooms|outfits: {name: gender}}
GENDERED = ("female", "male")


def curated_compat(
    kind: Literal["grooms", "outfits"], name: str, compat_file: Path = COMPAT_FILE
) -> str | None:
    """The gender gender_compat.json gives the groom style or outfit `name`, or None."""
    data = json.loads(compat_file.read_text(encoding="utf-8"))
    value = data[kind].get(name)
    if value is not None and value not in GENDERED:
        raise ValueError(f"{compat_file.name}: {kind}/{name} is {value!r}, not female or male")
    return value
