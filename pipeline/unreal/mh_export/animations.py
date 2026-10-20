"""Export MetaHuman template animations as sampled data the web runtime can play.

Body clips (stand idle, locomotion, ROM) are sampled per frame into local bone
transforms; face clips (expression loops, facial poses, face ROM) carry their
motion in rig control curves, sampled densely per frame. Each clip also gets an
FBX copy as a fallback. The converter later turns face curves into ARKit weight
tracks and body tracks into glTF animations.
"""

from __future__ import annotations

import struct
from pathlib import Path
from typing import Any

import unreal

from mh_export import inventory, ue
from mh_export.archive import Archive, JobLog, SkipList, Unit, run_units, safe_name, write_json
from mh_export.exporters import export_object, fbx_options

ROOTS = ("/MetaHumanCharacter/Optional/Animation", "/MetaHumanCharacter/Animation")
SKIP_NAMES = {"AS_MetaHuman_ARKit_Mapping"}  # exported by the arkit job
CONTROL_PREFIXES = ("ctrl_", "head_", "neck_")


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


def sample_bones(anim: unreal.AnimSequence, frames: int, out: Path) -> dict[str, Any]:
    """Local bone transforms per frame, written as little-endian float32 to `out`.

    Layout: frames x bones x 10 ([tx, ty, tz, qx, qy, qz, qw, sx, sy, sz], Unreal
    units). JSON lists of millions of floats made a 10 s clip take minutes.
    """
    names = [str(n) for n in unreal.AnimationLibrary.get_animation_track_names(anim)]
    if not names:
        return {"bones": [], "file": None}
    with out.open("wb") as handle:
        for frame in range(frames):
            poses = unreal.AnimationLibrary.get_bone_poses_for_frame(anim, names, frame, False)
            values = [v for pose in poses for v in transform_record(pose)]
            handle.write(struct.pack(f"<{len(values)}f", *values))
    return {"bones": names, "file": out.name, "layout": "frames x bones x [t3 q4 s3] float32 LE"}


def sample_curves(
    anim: unreal.AnimSequence, frames: int
) -> tuple[dict[str, list[float]], list[str]]:
    """Dense per-frame values of the rig control curves, plus every curve name.

    Face clips also carry ~900 derived mesh/blend-shape curves; the converter
    re-evaluates those through RigLogic from the controls, so only `ctrl_*`
    curves are sampled (sampling everything made each clip ~80 MB).
    """
    names = [
        str(n)
        for n in unreal.AnimationLibrary.get_animation_curve_names(
            anim, unreal.RawCurveTrackTypes.RCT_FLOAT
        )
    ]
    controls = [n for n in names if n.lower().startswith(CONTROL_PREFIXES)]
    times = [unreal.AnimationLibrary.get_time_at_frame(anim, f) for f in range(frames)]
    curves: dict[str, list[float]] = {}
    for name in controls:
        key_times, key_values = unreal.AnimationLibrary.get_float_keys(anim, name)
        curves[name] = _resample(list(key_times), list(key_values), times)
    return curves, names


def _resample(times: list[float], values: list[float], targets: list[float]) -> list[float]:
    """Linear interpolation of key (times, values) at sorted target times."""
    if not times:
        return [0.0] * len(targets)
    out: list[float] = []
    i = 0
    for t in targets:
        while i + 1 < len(times) and times[i + 1] < t:
            i += 1
        if t <= times[0]:
            out.append(float(values[0]))
        elif i + 1 >= len(times):
            out.append(float(values[-1]))
        else:
            t0, t1 = times[i], times[i + 1]
            v0, v1 = values[i], values[i + 1]
            out.append(float(v0 if t1 == t0 else v0 + (v1 - v0) * (t - t0) / (t1 - t0)))
    return out


def export_clip(path: str, work: Path) -> dict[str, Any]:
    anim = unreal.load_asset(path)
    frames = int(unreal.AnimationLibrary.get_num_frames(anim))
    length = float(unreal.AnimationLibrary.get_sequence_length(anim))
    skeleton = anim.get_editor_property("skeleton")
    curves, curve_names = sample_curves(anim, frames)
    # Face clips carry rig controls; RigLogic rebuilds the ~870 facial joints from
    # them, so their baked bone tracks are skipped.
    has_controls = any(name.lower().startswith("ctrl_") for name in curves)
    bones = (
        {"bones": [], "file": None}
        if has_controls
        else sample_bones(anim, frames, work / "bones.f32")
    )
    meta = {
        "asset": path,
        "frames": frames,
        "length_seconds": length,
        "fps": (frames - 1) / length if length > 0 and frames > 1 else 0.0,
        "skeleton": skeleton.get_path_name() if skeleton else None,
        "bone_count": len(bones["bones"]),
        "bones_skipped_for_controls": has_controls,
        "curve_count": len(curves),
        "all_curve_names": curve_names,
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
