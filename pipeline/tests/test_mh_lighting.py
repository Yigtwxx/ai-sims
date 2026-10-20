"""Lighting rigs: Unreal level actors -> asset-space lights with documented units."""

import math
from pathlib import Path

import pytest

from asset_pipeline.mh.lighting import (
    color_temperature,
    convert_level,
    has_lights,
    manifest_entry,
    parse_fcolor,
    to_candela,
    unreal_direction,
    unreal_point,
)


def test_unreal_points_become_metres_y_up_facing_z() -> None:
    # 1 m in front of a character facing Unreal +Y, 2 m up, 0.5 m to its left (+X).
    assert unreal_point([50.0, 100.0, 200.0]) == [0.5, 2.0, 1.0]


def test_rotator_forward_vectors() -> None:
    assert unreal_direction([0.0, 90.0, 0.0]) == pytest.approx([0.0, 0.0, 1.0], abs=1e-6)
    assert unreal_direction([-90.0, 0.0, 0.0]) == pytest.approx([0.0, -1.0, 0.0], abs=1e-6)


def test_light_units_convert_to_candela() -> None:
    assert to_candela(39.0, "<LightUnits.CANDELAS: 1>", "spot", 30) == 39.0
    assert to_candela(1.0, "<LightUnits.UNITLESS: 0>", "point", 44) == pytest.approx(0.0016)
    assert to_candela(4 * math.pi, "<LightUnits.LUMENS: 2>", "point", 44) == pytest.approx(1.0)
    assert to_candela(3.0, "<LightUnits.EV: 3>", "point", 44) == pytest.approx(1.0)


def test_colours_are_linear() -> None:
    assert parse_fcolor("(B=255,G=255,R=255,A=255)") == pytest.approx([1.0, 1.0, 1.0])
    red, green, blue = parse_fcolor("(B=0,G=0,R=128,A=255)")
    assert red == pytest.approx(0.2158605, abs=1e-6) and green == blue == 0.0
    warm = color_temperature(3000.0)
    cool = color_temperature(9000.0)
    assert warm[0] > warm[2] and cool[2] > cool[0]


@pytest.fixture(scope="module")
def studio(archive: Path) -> dict:
    level = archive / "raw" / "lighting" / "Studio"
    if not (level / "done.json").is_file():
        pytest.skip("Studio lighting level not exported")
    return convert_level(level)


def test_studio_rig_has_its_key_bounce_and_fill(studio: dict) -> None:
    lights = {light["name"]: light for light in studio["lights"]}
    assert {"KeyLight", "BounceLight", "FillLight"} <= set(lights)
    key = lights["KeyLight"]
    assert key["type"] == "spot" and key["intensity"] == 39.0
    x, y, z = key["position"]
    assert z > 2.0 and y > 2.5 and x < -1.0, "key light high, in front, to the character's right"
    _, dy, dz = key["direction"]
    assert dy < 0 and dz < 0, "it shines down and back towards the character"
    assert key["outerConeAngle"] == pytest.approx(math.radians(33.0), abs=1e-6)
    assert studio["exposure"]["scale"] == pytest.approx(1 / 1.2, abs=1e-6)
    assert studio["exposure"]["toneCurveAmount"] == 0.0
    assert has_lights(studio)
    entry = manifest_entry(studio, "lighting/studio.json")
    assert entry == {
        "id": "light.studio",
        "label": "Studio",
        "file": "lighting/studio.json",
        "order": 0,
    }
