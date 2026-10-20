"""Which wrinkle-mask channel belongs to which animated-map region.

RigLogic outputs animated-map weights named `<texture>.<region>` (e.g.
`head_wm1_normal.head_wm1_blink_L`); Unreal's head material multiplies each weight by one
channel of a wrinkle mask (`head_wm1_msk_01.tga` ...). The DNA does not record which
channel, but the masks follow one rule, checked channel by channel on the exported masks
(every one of the 37 channels covers the expected part of the face, `_L` on the
character's left):

    the regions of one wrinkle set (wm1, wm2, wm3, wm13), sorted by name, fill the set's
    masks in order (`msk_01`, `msk_02`, ...), channels R, G, B, A in turn.

So `head_wm1_blink_L` is `head_wm1_msk_01` R, `head_wm1_jawOpen` is `head_wm1_msk_03` R
and `head_wm2_neckStretch_R` is `head_wm2_msk_02` A; `head_wm2_msk_03` B is unused.
"""

import re
from collections.abc import Iterable, Sequence

REGION = re.compile(r"^head_(wm\d+)_")
MASK = re.compile(r"^head_(wm\d+)_msk_(\d+)$")


class WrinkleMaskError(ValueError):
    """The regions do not fit the masks."""


def region_of(map_name: str) -> str:
    """`head_cm1_color.head_wm1_blink_L` -> `head_wm1_blink_L`."""
    return map_name.split(".", 1)[1] if "." in map_name else map_name


def wrinkle_channels(
    map_names: Iterable[str], masks: Sequence[tuple[str, int]]
) -> dict[str, tuple[int, int]]:
    """Map every region to `(mask index, channel)`.

    Args:
        map_names: the DNA's animated map names (all of them, so regions the baked morphs
            never drive still claim their channel).
        masks: `(mask name, channel count)` in the order the skin lists its masks.
    """
    # wrinkle set -> (mask number, mask index, channel count)
    slots: dict[str, list[tuple[int, int, int]]] = {}
    for index, (name, channels) in enumerate(masks):
        match = MASK.match(name)
        if not match:
            raise WrinkleMaskError(f"unexpected wrinkle mask name {name}")
        slots.setdefault(match.group(1), []).append((int(match.group(2)), index, channels))
    regions: dict[str, set[str]] = {}
    for map_name in map_names:
        region = region_of(map_name)
        match = REGION.match(region)
        if match:
            regions.setdefault(match.group(1), set()).add(region)
    result: dict[str, tuple[int, int]] = {}
    for wrinkle_set, names in sorted(regions.items()):
        ordered = [
            (index, channel)
            for _, index, channels in sorted(slots.get(wrinkle_set, []))
            for channel in range(channels)
        ]
        if len(ordered) < len(names):
            raise WrinkleMaskError(
                f"{wrinkle_set}: {len(names)} regions but only {len(ordered)} mask channels"
            )
        for region, slot in zip(sorted(names), ordered, strict=False):
            result[region] = slot
    return dict(sorted(result.items()))
