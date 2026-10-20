"""Dump the ARKit-52 -> MetaHuman rig control mapping, which exists only in Unreal.

`PA_MetaHuman_ARKit_Mapping` is a PoseAsset built from `AS_MetaHuman_ARKit_Mapping`:
one pose per frame, each pose a set of `CTRL_expressions_*` curve values. The DNA
does not contain this table, so without it the Mac side cannot bake ARKit shapes.

Values are stored raw (dense, one value per pose per curve) together with the
Default pose; subtracting the Default pose, as the pose blend does, is left to
the converter. Exporting the animation as FBX produces an empty action, so the
curves are read through AnimationLibrary instead.
"""

from __future__ import annotations

from itertools import pairwise
from typing import Any

import unreal

from mh_export import inventory
from mh_export.archive import Archive, now_iso, write_json

POSE_ASSET_NAME = "PA_MetaHuman_ARKit_Mapping"

# ABP_MH_LiveLink applies this around the pose blend; there is no MouthClose pose.
MOUTH_CLOSE_RULE = {
    "formula": "clamp(safe_divide(MouthClose, JawOpen), 0, 1)",
    "safe_divide_zero": 0.0,
    "written_to": [
        "CTRL_expressions_mouthLipsTogetherDL",
        "CTRL_expressions_mouthLipsTogetherDR",
        "CTRL_expressions_mouthLipsTogetherUL",
        "CTRL_expressions_mouthLipsTogetherUR",
    ],
    "source": "ABP_MH_LiveLink (UE 5.8)",
}


def _keys(anim: unreal.AnimSequence, curve: str) -> list[tuple[float, float]]:
    times, values = unreal.AnimationLibrary.get_float_keys(anim, curve)
    return sorted((float(t), float(v)) for t, v in zip(times, values, strict=True))


def _sample(keys: list[tuple[float, float]], time: float) -> float:
    """Linear interpolation, clamped at both ends, matching curve evaluation."""
    if not keys:
        return 0.0
    if time <= keys[0][0]:
        return keys[0][1]
    if time >= keys[-1][0]:
        return keys[-1][1]
    for (t0, v0), (t1, v1) in pairwise(keys):
        if t0 <= time <= t1:
            return v0 if t1 == t0 else v0 + (v1 - v0) * (time - t0) / (t1 - t0)
    return keys[-1][1]


def _pose_times(anim: unreal.AnimSequence, pose_count: int) -> tuple[list[float], str]:
    """Pose i sits on frame i of the source animation."""
    try:
        times = [
            float(unreal.AnimationLibrary.get_time_at_frame(anim, frame))
            for frame in range(pose_count)
        ]
        return times, "frame_index"
    except Exception:
        length = float(anim.get_play_length())
        step = length / max(pose_count - 1, 1)
        return [i * step for i in range(pose_count)], "uniform_play_length"


def collect() -> dict[str, Any]:
    inventory.scan()
    candidates = inventory.find_by_name(POSE_ASSET_NAME)
    if not candidates:
        raise RuntimeError(f"{POSE_ASSET_NAME} not found under {inventory.CONTENT_ROOTS}")
    pose_asset = unreal.load_asset(candidates[0])
    anim = pose_asset.get_editor_property("source_animation")
    if anim is None:
        raise RuntimeError(f"{candidates[0]} has no source animation")

    pose_names = [str(name) for name in pose_asset.get_pose_names()]
    times, timing = _pose_times(anim, len(pose_names))
    curve_names = sorted(
        str(name)
        for name in unreal.AnimationLibrary.get_animation_curve_names(
            anim, unreal.RawCurveTrackTypes.RCT_FLOAT
        )
    )
    curves = {}
    for curve in curve_names:
        keys = _keys(anim, curve)
        curves[curve] = [round(_sample(keys, t), 6) for t in times]

    return {
        "created_at": now_iso(),
        "engine_version": unreal.SystemLibrary.get_engine_version(),
        "pose_asset": candidates[0],
        "pose_asset_candidates": candidates,
        "source_animation": anim.get_path_name(),
        "base_pose_name": str(pose_asset.get_base_pose_name()),
        "pose_names": pose_names,
        "pose_times": times,
        "pose_timing": timing,
        "curve_name_note": "Unreal lower-cases curve names; match DNA raw controls "
        "case-insensitively with '.' replaced by '_'",
        "curves": curves,
        "rules": {"mouth_close": MOUTH_CLOSE_RULE},
    }


def run(archive: Archive) -> dict[str, Any]:
    mapping = collect()
    write_json(archive.raw / "arkit" / "arkit_mapping.json", mapping)
    unreal.log(
        f"[mh_export] arkit: {len(mapping['pose_names'])} poses, {len(mapping['curves'])} curves"
    )
    return mapping
