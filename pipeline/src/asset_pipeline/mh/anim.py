"""Animation clips (`raw/animations/**/clip.json`) -> web animations.

Body clips (`bones.f32`: float32 LE, frames x bones x [t3 q4 s3], Unreal local transforms in
cm, left-handed Z-up) become one glTF animation in a GLB that holds the body skeleton
(node names = DNA joint names, so three.js binds the tracks to the character's bones):

- Unreal -> DNA/glTF joint space is a reflection of the local Y axis: `t' = (x, -y, z)`,
  `q' = (-qx, qy, -qz, qw)`; the root additionally keeps the DNA's Z-up -> Y-up rest
  rotation. Verified by forward kinematics: feet land on y = 0, the character faces +Z.
- Every live body joint (what the body GLB skins to) gets a rotation track, so a clip
  fully defines the pose; clips never move correctives or twist joints.
- Only the pelvis translates (the root never moves in these clips). Its keys are scaled by
  the leg-length ratio target/source so the feet stay on the floor of the female basis
  body; `extras.mh.retarget` lists the leg lengths for other bodies.
- Rotations are normalized SHORT quaternions (core glTF), times are float32 at the clip's
  own sample spacing, and every stream is meshopt-compressed.

Face clips (control curves `ctrl_expressions_*`) become ARKit weights: every frame is
evaluated with RigLogic on a reference head and the 52 ARKit morphs of that head are fitted
to the deformed head and teeth in vertex space (bounded least squares with a little
temporal smoothing). Visemes stay out of the basis so lip-sync keeps them to itself. Eye
joint rotations are written separately (deltas from rest) because morphs cannot rotate the
eyeballs.
"""

import json
import re
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy.linalg import cho_factor, cho_solve, solve_triangular
from scipy.optimize import lsq_linear

from asset_pipeline.mh.arkit import ARKIT_NAMES
from asset_pipeline.mh.bake import MorphTarget, mesh_kind
from asset_pipeline.mh.dna import DnaFile
from asset_pipeline.mh.glb import GlbBuilder, quantize_snorm16
from asset_pipeline.mh.gltf import GENERATOR, Space, neutral_joint_transforms
from asset_pipeline.mh.kinematics import quaternion_multiply, rotate_vectors
from asset_pipeline.mh.rig import MetaHumanRig, RigOutput

FACE_FPS = 30.0
FIT_MESHES = ("head", "teeth")
EYE_JOINTS = ("FACIAL_L_Eye", "FACIAL_R_Eye")
# Weight of ||w||^2 and ||w - w_prev||^2 relative to the mean diagonal of the Gram matrix.
RIDGE = 1e-4
SMOOTHING = 2e-3
WEIGHT_FLOOR = 0.01  # morphs below this in every frame are left out of the file
LEG_BONES = (("calf", "foot"), ("thigh", "calf"))
TWIST_JOINT = re.compile(r"_twist_\d+_")


class ClipError(ValueError):
    """A clip file is malformed or does not fit the skeleton."""


@dataclass(frozen=True)
class Clip:
    unit: Path
    asset: str
    frames: int
    length: float
    bones: tuple[str, ...]
    curves: dict[str, list[float]]
    properties: dict[str, Any]

    @classmethod
    def load(cls, unit: Path) -> "Clip":
        data = json.loads((unit / "clip.json").read_text(encoding="utf-8"))
        bones = data.get("bones", {})
        names = tuple(bones.get("bones", []) if isinstance(bones, dict) else [])
        return cls(
            unit=unit,
            asset=str(data.get("asset", "")),
            frames=int(data["frames"]),
            length=float(data["length_seconds"]),
            bones=names,
            curves={k: list(v) for k, v in data.get("curves", {}).items()},
            properties=dict(data.get("properties", {})),
        )

    @property
    def kind(self) -> str:
        return "body" if self.bones else "face"

    @property
    def times(self) -> NDArray[np.float64]:
        """Key times: the export samples `frames` keys from 0 to `length` inclusive."""
        return np.linspace(0.0, self.length, self.frames)

    def bone_data(self) -> NDArray[np.float64]:
        path = self.unit / "bones.f32"
        raw = np.fromfile(path, dtype="<f4")
        expected = self.frames * len(self.bones) * 10
        if raw.size != expected:
            raise ClipError(f"{path} holds {raw.size} floats, expected {expected}")
        return raw.reshape(self.frames, len(self.bones), 10).astype(np.float64)


# ---------------------------------------------------------------------------- naming


def _snake(text: str) -> str:
    text = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", text)
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


@dataclass(frozen=True)
class ClipInfo:
    id: str
    loop: bool
    tags: tuple[str, ...]
    file_stem: str


def describe(relative: Path, kind: str) -> ClipInfo:
    """Manifest id, loop flag and tags of a clip from its archive path."""
    parts = relative.parts
    name = parts[-1]
    if "Locomotion" in parts:
        stem = _snake(name.removeprefix("AS_MH_Neutral_"))
        gait = stem.split("_")[0]
        is_loop = "_loop" in stem
        # The web's idle picker reads `standing` and `calm` (full-body idles need 3 calm ones).
        tags = ("locomotion", gait) if gait != "stand" else ("idle", "standing", "calm")
        return ClipInfo(f"anim.{stem}", is_loop or gait == "stand", tags, stem)
    group = parts[-2] if len(parts) >= 2 else name
    category = parts[-3] if len(parts) >= 3 else ""
    if category == "Expression_Loops":
        emotion = re.sub(r"[AB]$", "", group).lower()
        stem = f"expression_{_snake(group)}_{kind}"
        return ClipInfo(
            f"anim.expression.{_snake(group)}.{kind}",
            True,
            ("expression", emotion, f"set:expression.{_snake(group)}"),
            stem,
        )
    if category == "Facial_Poses":
        stem = f"pose_{_snake(group)}_{kind}"
        return ClipInfo(f"anim.pose.{_snake(group)}.{kind}", False, ("pose", group.lower()), stem)
    if category == "Technical_Loops":
        if group == "Idle":
            return ClipInfo(f"anim.idle.{kind}", True, ("idle", "set:idle"), f"idle_{kind}")
        topic = _snake(group).replace("_r_o_m", "_rom").replace("r_o_m", "rom")
        stem = f"{topic}_{kind}"
        return ClipInfo(f"anim.{topic}.{kind}", False, ("technical", f"set:{topic}"), stem)
    stem = _snake("_".join(parts))
    return ClipInfo(f"anim.{stem}", True, (), stem)


def list_clip_units(archive: Path) -> list[Path]:
    """Finished clip exports (`clip.json` and `done.json`)."""
    root = archive / "raw" / "animations"
    if not root.is_dir():
        return []
    return sorted(p.parent for p in root.rglob("clip.json") if (p.parent / "done.json").is_file())


# ---------------------------------------------------------------------------- body clips

FLIP_T = np.array([1.0, -1.0, 1.0])
FLIP_Q = np.array([-1.0, 1.0, -1.0, 1.0])


def unreal_to_dna_local(
    translations: NDArray[np.float64], rotations: NDArray[np.float64]
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Unreal local transforms (cm, left-handed) -> DNA local space (cm), any leading shape."""
    rotations = rotations * FLIP_Q
    rotations /= np.linalg.norm(rotations, axis=-1, keepdims=True)
    return translations * FLIP_T, rotations


def continuous(quaternions: NDArray[np.float64]) -> NDArray[np.float64]:
    """Flip signs along time `(F, ..., 4)` so consecutive keys lie in one hemisphere."""
    out = quaternions.copy()
    for frame in range(1, len(out)):
        dots = np.sum(out[frame] * out[frame - 1], axis=-1)
        out[frame][dots < 0] *= -1.0
    return out


def leg_length(names: Sequence[str], translations: NDArray[np.float64]) -> float:
    """Mean thigh + shin length (cm) from local translations `(J, 3)`."""
    lower = {n.lower(): i for i, n in enumerate(names)}
    lengths = []
    for side in ("l", "r"):
        total = 0.0
        for _, child in LEG_BONES:
            total += float(np.linalg.norm(translations[lower[f"{child}_{side}"]]))
        lengths.append(total)
    return float(np.mean(lengths))


@dataclass(frozen=True)
class BodyTarget:
    """The skeleton body clips are written for (the female neutral basis by default), and
    its RigLogic rig, which poses the twist joints the clips leave at rest."""

    dna: DnaFile
    live: frozenset[str]
    leg_lengths: dict[str, float]  # gender -> metres
    gender: str
    rig: MetaHumanRig | None = None


def driven_rotations(
    rig: MetaHumanRig, rotations: NDArray[np.float64], joint_of: NDArray[np.int64]
) -> NDArray[np.float64]:
    """Evaluate the body rig on every frame and return all joints' local rotations
    `(F, J, 4)` (DNA space).

    The rig's raw controls are its driver joints' rotations as deltas from the neutral pose,
    `neutral^-1 * local` in DNA space (x, y, z, w). Checked on the body ROM clip, the one clip
    exported with Unreal's twist values: this reproduces them to 0.00 degrees (median).
    """
    _, neutral = neutral_joint_transforms(rig.dna, Space.from_descriptor(rig.dna.descriptor))
    names = rig.dna.joints.names
    clip_of = {int(joint): index for index, joint in enumerate(joint_of.tolist())}
    drivers = sorted({c.split(".")[0] for c in rig.control_names if c.endswith(".qw")})
    slots = []
    for driver in drivers:
        joint = names.index(driver)
        if joint not in clip_of:
            continue
        columns = [rig.control_index(f"{driver}.q{axis}") for axis in "xyzw"]
        inverse = neutral[joint] * np.array([-1.0, -1.0, -1.0, 1.0])
        slots.append((clip_of[joint], columns, inverse))
    out = np.empty((len(rotations), len(names), 4))
    rest = rig.rest_controls()
    for frame in range(len(rotations)):
        controls = rest.copy()
        for clip_index, columns, inverse in slots:
            controls[columns] = quaternion_multiply(inverse, rotations[frame, clip_index])
        out[frame] = rig.evaluate_raw(controls).local_rotations
    return out


def convert_body_clip(
    clip: Clip, target: BodyTarget, info: ClipInfo, output: Path, *, compress: bool = True
) -> dict[str, Any]:
    """Write the clip as a GLB animation; returns stats for the build record."""
    dna = target.dna
    space = Space.from_descriptor(dna.descriptor)
    lower = {name.lower(): index for index, name in enumerate(dna.joints.names)}
    missing = [b for b in clip.bones if b.lower() not in lower]
    if missing:
        raise ClipError(f"{clip.unit.name}: bones not in the body skeleton: {missing[:5]}")
    joint_of = np.array([lower[b.lower()] for b in clip.bones])
    data = clip.bone_data()
    translations, rotations = unreal_to_dna_local(data[..., 0:3], data[..., 3:7])

    rest_t, rest_q = neutral_joint_transforms(dna, space)  # glTF space, metres
    names = list(dna.joints.names)
    root = names.index("root")
    pelvis = names.index("pelvis")
    clip_root = int(np.flatnonzero(joint_of == root)[0])
    clip_pelvis = int(np.flatnonzero(joint_of == pelvis)[0])
    # Root: the DNA's rest rotation carries Z-up to Y-up; Unreal's root is the identity.
    rotations[:, clip_root] = quaternion_multiply(rest_q[root], rotations[:, clip_root])
    root_motion = rotate_vectors(rest_q[root], translations[:, clip_root] * space.scale)
    source_leg = leg_length(clip.bones, translations[0]) * space.scale
    target_leg = target.leg_lengths[target.gender]
    scale = target_leg / source_leg
    pelvis_keys = translations[:, clip_pelvis] * space.scale * scale

    builder = GlbBuilder(GENERATOR, compress=compress)
    children: dict[int, list[int]] = {}
    for joint, parent in enumerate(dna.joints.parents.tolist()):
        if parent >= 0:
            children.setdefault(parent, []).append(joint)
    for joint, name in enumerate(names):
        node: dict[str, Any] = {
            "name": name,
            "translation": rest_t[joint].tolist(),
            "rotation": rest_q[joint].tolist(),
        }
        if joint in children:
            node["children"] = children[joint]
        builder.add_node(node)
    times = builder.add_accessor(clip.times.astype(np.float32), bounds=True)
    samplers: list[dict[str, Any]] = []
    channels: list[dict[str, Any]] = []

    def track(values: NDArray[Any], joint: int, path: str, *, normalized: bool) -> None:
        output_accessor = builder.add_accessor(values, normalized=normalized)
        samplers.append({"input": times, "output": output_accessor, "interpolation": "LINEAR"})
        channels.append({"sampler": len(samplers) - 1, "target": {"node": joint, "path": path}})

    # Twist joints: clips keep them at rest; the body rig drives them from the arms and legs
    # (its drivers never include the root, whose rotation was re-based above).
    rig_rotations = driven_rotations(target.rig, rotations, joint_of) if target.rig else None
    twisted = 0
    animated = 0
    for clip_index, joint in enumerate(joint_of.tolist()):
        if names[joint] not in target.live:
            continue
        keys = rotations[:, clip_index]
        if rig_rotations is not None and TWIST_JOINT.search(names[joint]):
            keys = rig_rotations[:, joint]
            twisted += 1
        keys = continuous(keys)
        if compress:
            track(quantize_snorm16(keys), joint, "rotation", normalized=True)
        else:
            track(keys.astype(np.float32), joint, "rotation", normalized=False)
        animated += 1
    track(pelvis_keys.astype(np.float32), pelvis, "translation", normalized=False)
    if np.abs(root_motion).max() > 1e-6:
        track(root_motion.astype(np.float32), root, "translation", normalized=False)
    builder.add_animation({"name": info.id, "samplers": samplers, "channels": channels})
    roots = [int(j) for j in np.flatnonzero(dna.joints.parents < 0)]
    feet = _lowest_foot(clip, translations, rotations, joint_of, dna, scale, space)
    builder.add_scene(
        roots,
        extras={
            "mh": {
                "kind": "animation",
                "clip": clip.asset,
                "duration": clip.length,
                "frames": clip.frames,
                "fps": (clip.frames - 1) / clip.length if clip.length > 0 else 0.0,
                "loop": info.loop,
                "units": "m",
                "up": "+Y",
                "forward": "+Z",
                "tracks": {"rotation": animated, "translation": ["pelvis"]},
                "twist_joints": (
                    f"{twisted} twist joints posed by the body RigLogic rig"
                    if twisted
                    else "at rest"
                ),
                "retarget": {
                    "target": target.gender,
                    "source_leg_length_m": round(source_leg, 5),
                    "leg_lengths_m": {k: round(v, 5) for k, v in target.leg_lengths.items()},
                    "pelvis_scale": round(scale, 5),
                    "note": (
                        "pelvis translation keys are for the target body; for another body "
                        "multiply them by its leg length / leg_lengths_m[target] (body "
                        "sliders move the pelvis too: add the slider offset after the mixer)"
                    ),
                },
                "lowest_foot_y_m": feet,
            }
        },
    )
    data_out = builder.to_glb()
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".glb.tmp")
    temporary.write_bytes(data_out)
    temporary.replace(output)
    return {
        "bytes": len(data_out),
        "raw_bytes": builder.raw_bytes,
        "tracks": animated,
        "twist_tracks": twisted,
        "lowest_foot_y_m": feet,
    }


def _lowest_foot(
    clip: Clip,
    translations: NDArray[np.float64],
    rotations: NDArray[np.float64],
    joint_of: NDArray[np.int64],
    dna: DnaFile,
    scale: float,
    space: Space,
) -> float:
    """Lowest ball-of-foot height (m) over the clip on the target skeleton (QA)."""
    from asset_pipeline.mh.kinematics import compose_transforms, forward_kinematics

    rest_t, rest_q = neutral_joint_transforms(dna, space)
    names = list(dna.joints.names)
    balls = [names.index(n) for n in ("ball_l", "ball_r") if n in names]
    if not balls:
        return float("nan")
    lowest = np.inf
    pelvis = names.index("pelvis")
    for frame in np.linspace(0, clip.frames - 1, min(clip.frames, 60)).astype(int):
        local_q = rest_q.copy()
        local_t = rest_t.copy()
        local_q[joint_of] = rotations[frame]
        clip_pelvis = int(np.flatnonzero(joint_of == pelvis)[0])
        local_t[pelvis] = translations[frame, clip_pelvis] * space.scale * scale
        world = forward_kinematics(
            compose_transforms(local_t, local_q, np.ones_like(local_t)), dna.joints.parents
        )
        lowest = min(lowest, float(world[balls, 1, 3].min()))
    return round(lowest, 4)


# ---------------------------------------------------------------------------- face clips


def solve_bounded(
    gram: NDArray[np.float64],
    projection: NDArray[np.float64],
    *,
    ridge: float = 0.0,
    smooth: float = 0.0,
    previous: NDArray[np.float64] | None = None,
) -> NDArray[np.float64]:
    """Box-bounded ([0, 1]) least squares from its normal equations.

    Minimises `w' G w - 2 w' p + ridge |w|^2 + smooth |w - previous|^2` (G = B'B, p = B'd)
    by factoring the regularised system `S = U'U` and solving `min |U w - U^-T rhs|` with
    bounded-variable least squares, which has the same minimiser.
    """
    k = len(projection)
    weight = smooth if previous is not None else 0.0
    system = gram + (ridge + weight) * np.eye(k)
    rhs = projection + (weight * previous if previous is not None else 0.0)
    upper = np.triu(cho_factor(system, lower=False)[0])
    target = solve_triangular(upper, rhs, trans="T", lower=False)
    result = lsq_linear(upper, target, bounds=(0.0, 1.0), method="bvls")
    if result.success:
        return np.asarray(result.x)
    return np.clip(cho_solve((upper, False), rhs), 0.0, 1.0)


@dataclass
class FaceFitter:
    """Fits ARKit weights to RigLogic deformations of one reference head."""

    rig: MetaHumanRig
    names: tuple[str, ...]
    meshes: tuple[int, ...]
    basis: NDArray[np.float64]  # (3P, K) morph deltas of the fitted meshes
    reference: str

    @classmethod
    def from_targets(
        cls, rig: MetaHumanRig, targets: Sequence[MorphTarget], reference: str
    ) -> "FaceFitter":
        by_name = {t.name: t for t in targets}
        names = tuple(n for n in ARKIT_NAMES if n in by_name)
        dna = rig.dna
        meshes = tuple(m for m in dna.lod_meshes[0] if mesh_kind(dna.mesh_names[m]) in FIT_MESHES)
        columns = []
        for name in names:
            parts = []
            for mesh in meshes:
                morph = by_name[name].meshes.get(mesh)
                count = len(dna.mesh(mesh).positions)
                parts.append(np.zeros(count * 3) if morph is None else morph.positions.ravel())
            columns.append(np.concatenate(parts))
        return cls(rig, names, meshes, np.stack(columns, axis=1), reference)

    def __post_init__(self) -> None:
        gram = self.basis.T @ self.basis
        scale = float(np.mean(np.diag(gram)))
        self._ridge = RIDGE * scale
        self._smooth = SMOOTHING * scale
        self._gram = gram
        self._rest = np.concatenate(
            [self.rig.dna.mesh(m).positions.astype(np.float64).ravel() for m in self.meshes]
        )
        eyes = [self.rig.dna.joints.names.index(n) for n in EYE_JOINTS]
        self._eyes = eyes
        neutral = self.rig.evaluate_raw(self.rig.rest_controls())
        self._eye_rest = neutral.local_rotations[eyes]

    def displacement(self, controls: NDArray[np.float64]) -> tuple[NDArray[np.float64], RigOutput]:
        output = self.rig.evaluate_raw(controls)
        deformed = np.concatenate([self.rig.deform(m, output).ravel() for m in self.meshes])
        return deformed - self._rest, output

    def fit(
        self, displacement: NDArray[np.float64], previous: NDArray[np.float64] | None
    ) -> NDArray[np.float64]:
        """Weights in [0, 1] minimising |B w - d|^2 + ridge |w|^2 + smooth |w - previous|^2."""
        return solve_bounded(
            self._gram,
            self.basis.T @ displacement,
            ridge=self._ridge,
            smooth=self._smooth,
            previous=previous,
        )

    def eye_deltas(self, output: RigOutput) -> NDArray[np.float64]:
        """Local eye rotations as deltas from rest (`local = rest * delta`), x y z w."""
        rest_inverse = self._eye_rest * np.array([-1.0, -1.0, -1.0, 1.0])
        return quaternion_multiply(rest_inverse, output.local_rotations[self._eyes])


def convert_face_clip(
    clip: Clip, fitter: FaceFitter, info: ClipInfo, output: Path, *, fps: float = FACE_FPS
) -> dict[str, Any]:
    """Fit every resampled frame and write `{fps, names, frames, eyes, fit}` JSON."""
    rig = fitter.rig
    indices: dict[str, int] = {}
    unknown = []
    for curve in clip.curves:
        try:
            indices[curve] = rig.control_index(curve)
        except KeyError:
            unknown.append(curve)
    if not indices:
        raise ClipError(f"{clip.unit.name}: no curve matches a rig control")
    count = int(np.floor(clip.length * fps + 1e-6)) + 1
    times = np.arange(count) / fps
    source_times = clip.times
    # Unreal's RigLogic node clamps curve inputs to [0, 1]; so do we.
    sampled = {
        name: np.clip(np.interp(times, source_times, np.asarray(values, dtype=np.float64)), 0, 1)
        for name, values in clip.curves.items()
        if name in indices
    }
    rest = rig.rest_controls()
    weights = np.zeros((count, len(fitter.names)))
    eyes = np.zeros((count, 8))
    residual_rms = np.zeros(count)
    residual_max = np.zeros(count)
    motion_rms = np.zeros(count)
    previous = None
    for frame in range(count):
        controls = rest.copy()
        for name, values in sampled.items():
            controls[indices[name]] = values[frame]
        displacement, evaluated = fitter.displacement(controls)
        fitted = fitter.fit(displacement, previous)
        previous = fitted
        weights[frame] = fitted
        eyes[frame] = fitter.eye_deltas(evaluated).ravel()
        residual = (fitter.basis @ fitted - displacement).reshape(-1, 3)
        moved = np.linalg.norm(displacement.reshape(-1, 3), axis=1)
        error = np.linalg.norm(residual, axis=1)
        mask = moved > 0.01  # cm: vertices the frame moves
        residual_rms[frame] = float(np.sqrt(np.mean(error[mask] ** 2))) if mask.any() else 0.0
        motion_rms[frame] = float(np.sqrt(np.mean(moved[mask] ** 2))) if mask.any() else 0.0
        residual_max[frame] = float(error.max())
    keep = [i for i in range(len(fitter.names)) if weights[:, i].max() >= WEIGHT_FLOOR]
    frames = [[_round(v) for v in row] for row in weights[:, keep]]
    eye_frames = [[round(float(v), 5) for v in row] for row in eyes]
    data = {
        "fps": fps,
        "duration": round(clip.length, 4),
        "loop": info.loop,
        "names": [fitter.names[i] for i in keep],
        "frames": frames,
        "eyes": {
            "joints": list(EYE_JOINTS),
            "space": "local delta from the rest pose (bone.quaternion = rest * delta), x y z w",
            "frames": eye_frames,
        },
        "fit": {
            "method": "bounded least squares on RigLogic vertex displacements (head, teeth)",
            "basis": "ARKit 52",
            "reference_head": fitter.reference,
            "residual_rms_mm": round(float(np.mean(residual_rms)) * 10, 3),
            "residual_max_mm": round(float(residual_max.max()) * 10, 3),
            "motion_rms_mm": round(float(np.mean(motion_rms)) * 10, 3),
            "unmatched_curves": unknown,
        },
        "source": clip.asset,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(data, separators=(",", ":")) + "\n", encoding="utf-8")
    temporary.replace(output)
    return {
        "bytes": output.stat().st_size,
        "frames": count,
        "morphs": len(keep),
        "residual_rms_mm": data["fit"]["residual_rms_mm"],
        "residual_max_mm": data["fit"]["residual_max_mm"],
        "motion_rms_mm": data["fit"]["motion_rms_mm"],
    }


def _round(value: float) -> float | int:
    rounded = round(float(value), 3)
    return 0 if rounded == 0 else rounded
