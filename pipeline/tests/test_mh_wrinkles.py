"""Wrinkle-mask channels: regions fill each set's masks in name order, RGBA in turn."""

import pytest

from asset_pipeline.mh.dna import read_dna
from asset_pipeline.mh.textures import MASK_CHANNELS, MASK_ORDER
from asset_pipeline.mh.wrinkles import WrinkleMaskError, region_of, wrinkle_channels

MASKS = [(name, MASK_CHANNELS[name]) for name in MASK_ORDER]


def test_region_of_strips_the_texture() -> None:
    assert region_of("head_cm1_color.head_wm1_blink_L") == "head_wm1_blink_L"
    assert region_of("head_wm1_blink_L") == "head_wm1_blink_L"


def test_regions_fill_channels_in_name_order() -> None:
    names = [
        "head_wm1_normal.head_wm1_jawOpen",
        "head_cm1_color.head_wm1_blink_R",
        "head_wm1_normal.head_wm1_blink_L",
        "head_cm2_color.head_wm2_browsDown_L",
    ]
    channels = wrinkle_channels(names, MASKS)
    assert channels == {
        "head_wm1_blink_L": (0, 0),
        "head_wm1_blink_R": (0, 1),
        "head_wm1_jawOpen": (0, 2),
        "head_wm2_browsDown_L": (4, 0),
    }


def test_too_many_regions_for_the_masks_raise() -> None:
    names = [f"head_wm13_lips_{i}" for i in range(5)]
    with pytest.raises(WrinkleMaskError):
        wrinkle_channels(names, MASKS)


def test_ada_regions_land_on_the_channels_seen_in_the_masks(bindings, ada_head_path) -> None:
    dna = read_dna(ada_head_path, geometry=False)
    channels = wrinkle_channels(dna.behavior.animated_map_names, MASKS)
    # Checked by eye on the exported masks (character's left on the image's right).
    expected = {
        "head_wm1_blink_L": (0, 0),
        "head_wm1_browsRaiseInner_R": (0, 3),
        "head_wm1_jawOpen": (2, 0),
        "head_wm1_squintInner_R": (3, 2),
        "head_wm2_neckStretch_R": (5, 3),
        "head_wm2_noseWrinkler_L": (6, 0),
        "head_wm3_smile_L": (8, 2),
        "head_wm13_lips_UR": (9, 3),
    }
    for region, slot in expected.items():
        assert channels[region] == slot, region
    assert len(channels) == 37
