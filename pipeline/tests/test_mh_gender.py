"""Preset gender from the MetaHuman masculine/feminine body value."""

import pytest

from asset_pipeline.mh.convert import axis_gender


@pytest.mark.parametrize(
    ("record", "expected"),
    [
        ({"masculine_feminine": 0.64, "gender": "female"}, "female"),
        ({"masculine_feminine": -0.59, "gender": "male"}, "male"),
        # Asha: the sign says male, the preset is a woman; too close to call by the axis.
        ({"masculine_feminine": -0.13, "gender": "male"}, None),
        ({"gender": "female"}, "female"),
        ({"gender": "other"}, None),
        (None, None),
    ],
)
def test_axis_gender_reads_clear_values_and_defers_near_the_middle(
    record: dict[str, object] | None, expected: str | None
) -> None:
    assert axis_gender(record) == expected, f"Expected {expected} for {record}"
