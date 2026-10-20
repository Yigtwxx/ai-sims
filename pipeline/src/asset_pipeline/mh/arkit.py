"""ARKit 52 blend shape names and Unreal's ARKit -> MetaHuman control mapping.

Unreal drives a MetaHuman face from ARKit weights with the pose asset
`PA_MetaHuman_ARKit_Mapping` (dumped by `pipeline/unreal/mh_export/arkit.py`): pose `p` sets
raw rig controls (`CTRL_expressions_*`) and blends additively over its `Default` pose, so
the controls of ARKit shape `p` are `pose_p - Default`. `mouthClose` has no pose:
`ABP_MH_LiveLink` writes `clamp(MouthClose / JawOpen, 0, 1)` to the four
`mouthLipsTogether*` controls, i.e. it closes the lips relative to an open jaw.

The dump also lists blend shape and wrinkle-map curves; those were sampled between keys
(e.g. MouthPucker reads `jaw_fwd 0.53 + mouth_left 0.47`) and are not usable as reference
values. Only the raw control curves are read here; RigLogic recomputes everything else.
"""

import json
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from asset_pipeline.mh.rig import normalize_control_name

# Apple's ARFaceAnchor.BlendShapeLocation names, in Apple's documentation order.
ARKIT_NAMES: tuple[str, ...] = (
    "eyeBlinkLeft", "eyeLookDownLeft", "eyeLookInLeft", "eyeLookOutLeft", "eyeLookUpLeft",
    "eyeSquintLeft", "eyeWideLeft", "eyeBlinkRight", "eyeLookDownRight", "eyeLookInRight",
    "eyeLookOutRight", "eyeLookUpRight", "eyeSquintRight", "eyeWideRight", "jawForward",
    "jawLeft", "jawRight", "jawOpen", "mouthClose", "mouthFunnel", "mouthPucker", "mouthLeft",
    "mouthRight", "mouthSmileLeft", "mouthSmileRight", "mouthFrownLeft", "mouthFrownRight",
    "mouthDimpleLeft", "mouthDimpleRight", "mouthStretchLeft", "mouthStretchRight",
    "mouthRollLower", "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper", "mouthPressLeft",
    "mouthPressRight", "mouthLowerDownLeft", "mouthLowerDownRight", "mouthUpperUpLeft",
    "mouthUpperUpRight", "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft",
    "browOuterUpRight", "cheekPuff", "cheekSquintLeft", "cheekSquintRight", "noseSneerLeft",
    "noseSneerRight", "tongueOut",
)  # fmt: skip
MOUTH_CLOSE = "mouthClose"
JAW_OPEN = "jawOpen"
CONTROL_PREFIX = "ctrl_expressions_"
MIN_CONTROL = 1e-6


class ArkitMappingError(ValueError):
    """The mapping file is missing poses or does not fit the DNA's controls."""


@dataclass(frozen=True)
class ArkitMapping:
    path: Path
    engine_version: str
    # ARKit name -> {DNA raw control name: value}, Default subtracted (all but mouthClose).
    poses: dict[str, dict[str, float]]
    # DNA controls the mouthClose rule writes (the four mouthLipsTogether* controls).
    mouth_close_controls: tuple[str, ...]
    # Control curves of the pose asset that the DNA does not have (ignored).
    unmatched_curves: tuple[str, ...]

    def controls(self, name: str) -> dict[str, float]:
        """Raw controls of one ARKit shape; `mouthClose` is relative to `jawOpen`, so it
        returns the jaw-open controls plus closed lips (see `bake.arkit_shapes`)."""
        if name == MOUTH_CLOSE:
            closed = dict(self.poses[JAW_OPEN])
            closed.update(dict.fromkeys(self.mouth_close_controls, 1.0))
            return closed
        return dict(self.poses[name])


def arkit_name(pose_name: str) -> str:
    """`EyeBlinkLeft` (pose asset) -> `eyeBlinkLeft` (Apple)."""
    return pose_name[:1].lower() + pose_name[1:]


def load_arkit_mapping(path: Path | str, control_names: Sequence[str]) -> ArkitMapping:
    """Read the dumped mapping and resolve its curves to the DNA's raw control names.

    Raises:
        ArkitMappingError: a pose or the mouthClose rule is missing, or a rule control is
            not in the DNA.
    """
    path = Path(path)
    data = json.loads(path.read_text(encoding="utf-8"))
    pose_names: list[str] = data["pose_names"]
    curves: dict[str, list[float]] = data["curves"]
    base = pose_names.index(data["base_pose_name"])
    lookup = {normalize_control_name(name): name for name in control_names}

    control_curves = {
        key: values for key, values in curves.items() if key.startswith(CONTROL_PREFIX)
    }
    unmatched = tuple(sorted(key for key in control_curves if key not in lookup))
    poses: dict[str, dict[str, float]] = {}
    for index, pose in enumerate(pose_names):
        name = arkit_name(pose)
        if name not in ARKIT_NAMES:
            continue  # Default and the unused Pose_N slots
        controls = {}
        for key, values in control_curves.items():
            delta = values[index] - values[base]
            if key in lookup and abs(delta) > MIN_CONTROL:
                controls[lookup[key]] = float(delta)
        poses[name] = controls
    missing = [name for name in ARKIT_NAMES if name != MOUTH_CLOSE and name not in poses]
    if missing:
        raise ArkitMappingError(f"{path.name} lacks ARKit poses {missing}")

    rule = data.get("rules", {}).get("mouth_close")
    if not rule:
        raise ArkitMappingError(f"{path.name} has no mouth_close rule")
    written = []
    for control in rule["written_to"]:
        key = normalize_control_name(control)
        if key not in lookup:
            raise ArkitMappingError(f"mouthClose writes {control}, which the DNA lacks")
        written.append(lookup[key])
    return ArkitMapping(
        path=path,
        engine_version=str(data.get("engine_version", "")),
        poses=poses,
        mouth_close_controls=tuple(written),
        unmatched_curves=unmatched,
    )
