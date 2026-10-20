"""Export MetaHuman template animations as sampled data the web runtime can play.

Body clips (stand idle, locomotion, ROM) are sampled per frame into local bone
transforms; face clips (expression loops, facial poses, face ROM) carry their
motion in rig control curves, sampled densely per frame. Each clip also gets an
FBX copy as a fallback. The converter later turns face curves into ARKit weight
tracks and body tracks into glTF animations.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import unreal

from mh_export import inventory, ue
from mh_export.archive import Archive, JobLog, SkipList, Unit, run_units, safe_name, write_json
from mh_export.exporters import export_object, fbx_options

ROOTS = ("/MetaHumanCharacter/Optional/Animation", "/MetaHumanCharacter/Animation")
SKIP_NAMES = {"AS_MetaHuman_ARKit_Mapping"}  # exported by the arkit job


def clip_paths() -> list[str]:
    inventory.scan(ROOTS)
    paths = inventory.find_assets({"AnimSequence"}, ROOTS)
    return [p for p in paths if p.rsplit(".", 1)[-1] not in SKIP_NAMES]


def transform_record(transform: unreal.Transform) -> list[float]:
    """[tx, ty, tz, qx, qy, qz, qw, sx, sy, sz] in Unreal units (cm, left-handed Z-up)."""
    t = transform.translation
    q = transform.rotation
    s = transform.scale3d
    return [t.x, t.y, t.z, q.x, q.y, q.z, q.w, s.x, s.y, s.z]


def sample_bones(anim: unreal.AnimSequence, frames: int) -> dict[str, Any]:
    names = list(unreal.AnimationLibrary.get_animation_track_names(anim))
    if not names:
        return {"bones": [], "frames": []}
    samples = []
    for frame in range(frames):
        poses = unreal.AnimationLibrary.get_bone_poses_for_frame(anim, names, frame, False)
        samples.append([transform_record(pose) for pose in poses])
    return {"bones": [str(n) for n in names], "frames": samples}


def sample_curves(anim: unreal.AnimSequence, frames: int) -> dict[str, list[float]]:
    curves: dict[str, list[float]] = {}
    names = unreal.AnimationLibrary.get_animation_curve_names(
        anim, unreal.RawCurveTrackTypes.RCT_FLOAT
    )
    times = [unreal.AnimationLibrary.get_time_at_frame(anim, f) for f in range(frames)]
    for name in names:
        key_times, key_values = unreal.AnimationLibrary.get_float_keys(anim, name)
        curves[str(name)] = [_sample(list(key_times), list(key_values), t) for t in times]
    return curves


def _sample(times: list[float], values: list[float], t: float) -> float:
    if not times:
        return 0.0
    if t <= times[0]:
        return float(values[0])
    for (t0, v0), (t1, v1) in zip(
        zip(times, values, strict=True), zip(times[1:], values[1:], strict=True), strict=False
    ):
        if t0 <= t <= t1:
            return float(v0 if t1 == t0 else v0 + (v1 - v0) * (t - t0) / (t1 - t0))
    return float(values[-1])


def export_clip(path: str, work: Path) -> dict[str, Any]:
    anim = unreal.load_asset(path)
    frames = int(unreal.AnimationLibrary.get_num_frames(anim))
    length = float(unreal.AnimationLibrary.get_sequence_length(anim))
    skeleton = anim.get_editor_property("skeleton")
    bones = sample_bones(anim, frames)
    curves = sample_curves(anim, frames)
    meta = {
        "asset": path,
        "frames": frames,
        "length_seconds": length,
        "fps": (frames - 1) / length if length > 0 and frames > 1 else 0.0,
        "skeleton": skeleton.get_path_name() if skeleton else None,
        "bone_count": len(bones["bones"]),
        "curve_count": len(curves),
        "properties": ue.dump_properties(
            anim, ["rate_scale", "interpolation", "enable_root_motion"]
        ),
    }
    write_json(work / "clip.json", {**meta, "bones": bones, "curves": curves})
    name = path.rsplit(".", 1)[-1]
    meta["fbx"] = export_object(anim, work / f"{name}.fbx", fbx_options())
    return meta


def run(archive: Archive, args: dict[str, Any]) -> dict[str, Any]:
    """Args: only (list of clip names), force."""
    only = set(args.get("only") or [])
    clips = [p for p in clip_paths() if not only or p.rsplit(".", 1)[-1] in only]
    units = []
    for path in clips:
        package = path.rsplit(".", 1)[0]
        rel = package.split("/Animation/", 1)[-1]
        parts = [safe_name(part) for part in rel.split("/")]
        units.append(
            Unit(
                name=f"animations/{'/'.join(parts)}",
                directory=archive.unit_dir("animations", *parts),
                export=lambda work, path=path: export_clip(path, work),
            )
        )
    log = JobLog(archive.logs, "animations")
    summary = run_units(units, log, force=bool(args.get("force")), skip=SkipList(archive.skip_file))
    return {"clips": len(units), "log": str(log.path), **summary.as_dict()}
