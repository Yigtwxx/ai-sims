"""Hair card plans for the Fab grooms without cards (pipeline/unreal/mh_export/card_plans.py)."""

import re

import pytest
from mh_export.card_plans import (
    HANDMADE,
    PLANS,
    CardLod,
    CardPlan,
    generation_settings_text,
    intermediate_entries,
)

from asset_pipeline.mh.grooms import CARD_MESH, TEXTURE_ROLES


def _plan(**changes: object) -> CardPlan:
    fields: dict[str, object] = {
        "style": "Hair_Test",
        "clumps": 300,
        "textures": 100,
        "lods": (CardLod(0, 30000, 40), CardLod(1, 20000, 40, reduce=True)),
    }
    fields.update(changes)
    return CardPlan(**fields)  # type: ignore[arg-type]


def test_settings_text_lists_every_lod_with_its_counts() -> None:
    text = generation_settings_text(_plan())
    assert text.startswith("((LODIndex=0,") and text.endswith("))")
    lods = re.findall(r"\(LODIndex=(\d+),GroupIndex=0,", text)
    assert lods == ["0", "1"]
    assert text.count("NumClumps=300") == 2, "reductions keep LOD0's clumps"
    assert "NumTriangles=30000" in text and "NumTriangles=20000" in text
    reduce_flags = re.findall(r"bReduceCardsFromPreviousLOD=(\w+)", text)
    assert reduce_flags == ["False", "True"]
    assert "AtlasSize=AtlasSize4096" in text
    assert "StrandWidthScalingFactor=2.000000" in text
    assert text.count("(") == text.count(")"), "balanced for Unreal's property import"


def test_settings_text_keeps_one_lod_when_asked() -> None:
    text = generation_settings_text(_plan(), lod_index=1)
    assert re.findall(r"LODIndex=(\d+)", text) == ["1"]
    with pytest.raises(ValueError, match="no LOD 5"):
        generation_settings_text(_plan(), lod_index=5)


@pytest.mark.parametrize(
    "lods, message",
    [
        ((CardLod(0, 1, 1), CardLod(2, 1, 1, reduce=True)), "without gaps"),
        ((CardLod(0, 1, 1, reduce=True),), "LOD0 cannot be reduced"),
    ],
)
def test_plans_reject_lod_chains_the_generator_cannot_derive(lods, message) -> None:
    with pytest.raises(ValueError, match=message):
        generation_settings_text(_plan(lods=lods))


def test_every_plan_reduces_with_the_same_flyaways() -> None:
    # Fewer flyaways in a reduction means fewer cards than LOD0's atlas layout indexes.
    for plan in PLANS.values():
        plan.validate()
        assert len({lod.flyaways for lod in plan.lods}) == 1, plan.style
        assert [lod.reduce for lod in plan.lods] == [False] + [True] * (len(plan.lods) - 1)
        assert 2 in {lod.lod for lod in plan.lods}, "the converter's light LOD is LOD2"


def test_generated_and_handmade_names_are_what_the_converter_reads() -> None:
    for plan in PLANS.values():
        for name in plan.lod_names():
            assert CARD_MESH.search(name) and CARD_MESH.search(f"{name}_PG0"), name
    for cards in HANDMADE.values():
        assert cards.style not in PLANS, "a style is either generated or hand-made"
        for lod in range(len(cards.lods)):
            match = CARD_MESH.search(cards.mesh_name(lod))
            assert match and match.group(1) == str(lod)
        for role in ("attribute", "tangent"):
            roles = [
                r for pattern, r, _, _ in TEXTURE_ROLES if pattern.search(cards.texture_name(role))
            ]
            assert roles[:1] == [role]


def test_intermediates_of_a_plan_are_only_its_own() -> None:
    names = [
        "Ponytail_CardsMesh_LOD0.json",
        "Ponytail_CardsMesh_LOD1_GIDX0",
        "Ponytail_CardsMesh_LOD0",
        "PonytailGroom_CardsMesh_LOD0.json",
        "Ponytail_Other.json",
        "_generated",
    ]
    assert intermediate_entries(names, "Ponytail_CardsMesh") == [
        "Ponytail_CardsMesh_LOD0",
        "Ponytail_CardsMesh_LOD0.json",
        "Ponytail_CardsMesh_LOD1_GIDX0",
    ]
