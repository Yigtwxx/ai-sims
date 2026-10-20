"""Reference DNA files that ship with Unreal Engine 5.8 (read-only).

They serve as test fixtures and references for the converter:

- `ARCHETYPE_HEAD`: the archetype face rig (8 LODs, 870 joints, 263 raw controls, PSDs,
  neck-corrective RBF, animated maps; no blend shapes).
- `ARCHETYPE_BODY`: the archetype body rig (twist/swing + RBF correctives).
- `BODY_MODEL`: the body identity template (one mesh, 379 shape blend shapes, no valid
  coordinate system in its descriptor).
- `RIGLOGIC_UNIT_TEST`: RigLogic's tiny synthetic rig (metres/radians, 3 triangles).
- `fixed_compatibility_body(...)`: the 18 fixed-compatibility bodies (`f_med_nrw`, …).

Locations: `$UE_ROOT/Engine/Plugins/...` (default `C:\\Program Files\\Epic Games\\UE_5.8`).
Set `MH_ENGINE_DNA_DIR` to a flat directory holding copies (same file names) to use them
without Unreal, e.g. on macOS.
"""

import os
from pathlib import Path

DEFAULT_UE_ROOT = Path(r"C:\Program Files\Epic Games\UE_5.8")
ENV_COPIES = "MH_ENGINE_DNA_DIR"

_PLUGINS = Path("Engine") / "Plugins"
_METAHUMAN = _PLUGINS / "MetaHuman"
ARCHETYPE_HEAD = _METAHUMAN / "MetaHumanCoreTechLib/Content/ArchetypeDNA/SKM_Face.dna"
ARCHETYPE_BODY = _METAHUMAN / "MetaHumanCoreTechLib/Content/ArchetypeDNA/SKM_Body.dna"
ARCHETYPE_COMBINED_BODY = (
    _METAHUMAN / "MetaHumanCoreTechLib/Content/ArchetypeDNA/body_head_combined.dna"
)
BODY_MODEL = _METAHUMAN / "MetaHumanCharacter/Content/Body/IdentityTemplate/body_model.dna"
FIXED_COMPATIBILITY_DIR = _METAHUMAN / "MetaHumanCharacter/Content/Optional/Body/FixedCompatibility"
RIGLOGIC_UNIT_TEST = _PLUGINS / "Animation/RigLogic/Content/Test/DNA/rl_unit_behavior_test.dna"

BODY_GENDERS = ("f", "m")
BODY_HEIGHTS = ("srt", "med", "tal")
BODY_WEIGHTS = ("nrw", "ovw", "unw")


def ue_root() -> Path:
    return Path(os.environ.get("UE_ROOT", str(DEFAULT_UE_ROOT)))


def engine_dna(relative: Path) -> Path:
    """Absolute path of an engine DNA (`MH_ENGINE_DNA_DIR` copy first). May not exist."""
    copies = os.environ.get(ENV_COPIES)
    if copies:
        return Path(copies) / relative.name
    return ue_root() / relative


def fixed_compatibility_body(gender: str, height: str, weight: str) -> Path:
    """One of the 18 fixed-compatibility body DNAs, e.g. `("f", "med", "nrw")`."""
    if gender not in BODY_GENDERS or height not in BODY_HEIGHTS or weight not in BODY_WEIGHTS:
        raise ValueError(f"unknown body {gender}_{height}_{weight}")
    return engine_dna(FIXED_COMPATIBILITY_DIR / f"{gender}_{height}_{weight}.dna")
