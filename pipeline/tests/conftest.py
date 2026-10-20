"""Shared fixtures for the MetaHuman converter tests (`asset_pipeline.mh`).

Inputs are optional: tests skip when the OpenRigLogic bindings are not built
(`scripts/build_openriglogic.py`), when Unreal's engine DNAs are absent (see
`asset_pipeline.mh.engine`), or when the MetaHumanArchive export of Ada is missing
(`MH_ARCHIVE`, default `~/MetaHumanArchive`). Heavy fixtures are session-scoped.
"""

from collections.abc import Callable
from pathlib import Path

import pytest

from asset_pipeline.mh import engine
from asset_pipeline.mh.arkit import ArkitMapping, load_arkit_mapping
from asset_pipeline.mh.bake import (
    MorphBaker,
    MorphTarget,
    arkit_shapes,
    head_bake_meshes,
    viseme_shapes,
)
from asset_pipeline.mh.convert import archive_root
from asset_pipeline.mh.dna import read_dna
from asset_pipeline.mh.openriglogic import is_available
from asset_pipeline.mh.qa import MouthLandmarks
from asset_pipeline.mh.rig import MetaHumanRig
from asset_pipeline.mh.visemes import VISEME_RECIPES

CHARACTER = "Ada"


@pytest.fixture(scope="session")
def bindings() -> None:
    if not is_available():
        pytest.skip("OpenRigLogic bindings not built (scripts/build_openriglogic.py)")


@pytest.fixture(scope="session")
def engine_dna() -> Callable[[Path], Path]:
    """`engine_dna(engine.ARCHETYPE_HEAD)` -> existing path, or skip."""

    def find(relative: Path) -> Path:
        path = engine.engine_dna(relative)
        if not path.is_file():
            pytest.skip(f"engine DNA not available: {path}")
        return path

    return find


@pytest.fixture(scope="session")
def archive() -> Path:
    root = archive_root()
    if not (root / "raw" / "characters" / CHARACTER / "done.json").is_file():
        pytest.skip(f"no finished {CHARACTER} export in {root}")
    return root


@pytest.fixture(scope="session")
def ada_head_path(bindings: None, archive: Path) -> Path:
    return archive / "raw" / "characters" / CHARACTER / "dcc" / CHARACTER / "head.dna"


@pytest.fixture(scope="session")
def arkit_mapping_path(archive: Path) -> Path:
    path = archive / "raw" / "arkit" / "arkit_mapping.json"
    if not path.is_file():
        pytest.skip(f"no ARKit mapping at {path}")
    return path


@pytest.fixture(scope="session")
def ada_rig(ada_head_path: Path) -> MetaHumanRig:
    return MetaHumanRig(read_dna(ada_head_path, lods=[0]))


@pytest.fixture(scope="session")
def ada_mapping(ada_rig: MetaHumanRig, arkit_mapping_path: Path) -> ArkitMapping:
    return load_arkit_mapping(arkit_mapping_path, ada_rig.control_names)


@pytest.fixture(scope="session")
def ada_baker(ada_rig: MetaHumanRig) -> MorphBaker:
    meshes, frozen = head_bake_meshes(ada_rig, lod=0)
    return MorphBaker(ada_rig, meshes, frozen=frozen)


@pytest.fixture(scope="session")
def ada_targets(ada_baker: MorphBaker, ada_mapping: ArkitMapping) -> dict[str, MorphTarget]:
    """Every baked target of Ada's head (52 ARKit + 15 visemes), by name."""
    shapes = {**arkit_shapes(ada_mapping), **viseme_shapes(VISEME_RECIPES)}
    return {target.name: target for target in ada_baker.bake_all(shapes)}


@pytest.fixture(scope="session")
def ada_mouth(ada_rig: MetaHumanRig) -> MouthLandmarks:
    return MouthLandmarks.find(ada_rig, "head_lod0_mesh", "teeth_lod0_mesh")
