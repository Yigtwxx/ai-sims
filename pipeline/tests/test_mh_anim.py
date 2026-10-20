"""Animation conversion: Unreal -> asset space, clip naming, face fitting, a real body clip."""

from pathlib import Path

import numpy as np
import pytest

from asset_pipeline.mh.anim import (
    Clip,
    ClipInfo,
    continuous,
    convert_body_clip,
    describe,
    driven_rotations,
    leg_length,
    solve_bounded,
    unreal_to_dna_local,
)
from asset_pipeline.mh.build import Builder
from asset_pipeline.mh.glb import accessor_values, read_glb
from asset_pipeline.mh.kinematics import quaternion_to_matrix

STAND_IDLE = Path("UEFNAnimPreset/Locomotion/AS_MH_Neutral_Stand_Idle_Loop")
BODY_ROM = Path("TemplateAnimations/Technical_Loops/BodyROM/mhc_body_rom_body")


def test_unreal_local_transforms_reflect_the_y_axis() -> None:
    translations = np.array([[1.0, 2.0, 3.0]])
    angle = np.radians(30)
    about_z = np.array([[0.0, 0.0, np.sin(angle / 2), np.cos(angle / 2)]])
    t, q = unreal_to_dna_local(translations, about_z)
    assert t.tolist() == [[1.0, -2.0, 3.0]]
    # A rotation conjugated by a reflection keeps its angle and maps its axis (z -> -z).
    flip = np.diag([1.0, -1.0, 1.0])
    expected = flip @ quaternion_to_matrix(about_z[0]) @ flip
    np.testing.assert_allclose(quaternion_to_matrix(q[0]), expected, atol=1e-12)


def test_continuous_keeps_quaternions_in_one_hemisphere() -> None:
    keys = np.array([[0, 0, 0, 1.0], [0, 0, -0.1, -0.995], [0, 0, 0.2, 0.98]])
    fixed = continuous(keys[:, None, :])[:, 0]
    assert np.all(np.sum(fixed[1:] * fixed[:-1], axis=1) > 0)


@pytest.mark.parametrize(
    ("path", "kind", "expected"),
    [
        (
            "TemplateAnimations/Expression_Loops/HappyA/mhc_x_b_happy",
            "body",
            ClipInfo(
                "anim.expression.happy_a.body",
                True,
                ("expression", "happy", "set:expression.happy_a"),
                "expression_happy_a_body",
            ),
        ),
        (
            "TemplateAnimations/Facial_Poses/Sad/mhc_x_f_gpf_sad",
            "face",
            ClipInfo("anim.pose.sad.face", False, ("pose", "sad"), "pose_sad_face"),
        ),
        (
            "TemplateAnimations/Technical_Loops/Idle/mhc_mh001_fmn_f_idle",
            "face",
            ClipInfo("anim.idle.face", True, ("idle", "set:idle"), "idle_face"),
        ),
        (
            "UEFNAnimPreset/Locomotion/AS_MH_Neutral_Walk_Start_F_Rfoot",
            "body",
            ClipInfo(
                "anim.walk_start_f_rfoot", False, ("locomotion", "walk"), "walk_start_f_rfoot"
            ),
        ),
        (
            "UEFNAnimPreset/Locomotion/AS_MH_Neutral_Stand_Idle_Loop",
            "body",
            ClipInfo("anim.stand_idle_loop", True, ("idle", "standing", "calm"), "stand_idle_loop"),
        ),
    ],
)
def test_describe_names_clips_stably(path: str, kind: str, expected: ClipInfo) -> None:
    assert describe(Path(path), kind) == expected


def test_solve_bounded_recovers_weights_and_respects_bounds() -> None:
    rng = np.random.default_rng(1)
    basis = rng.normal(size=(300, 6))
    truth = np.array([0.0, 0.2, 0.5, 1.0, 0.0, 0.7])
    displacement = basis @ truth
    weights = solve_bounded(basis.T @ basis, basis.T @ displacement)
    np.testing.assert_allclose(weights, truth, atol=1e-8)
    clipped = solve_bounded(basis.T @ basis, basis.T @ (basis @ (truth * 3)))
    assert clipped.min() >= 0.0 and clipped.max() <= 1.0
    previous = np.full(6, 0.5)
    smoothed = solve_bounded(basis.T @ basis, basis.T @ displacement, smooth=1e6, previous=previous)
    np.testing.assert_allclose(smoothed, previous, atol=1e-3)


def test_leg_length_sums_thigh_and_shin() -> None:
    names = ["thigh_l", "calf_l", "foot_l", "thigh_r", "calf_r", "foot_r"]
    translations = np.array(
        [[0, 0, 0], [40, 0, 0], [0, 38, 0], [0, 0, 0], [42, 0, 0], [0, 0, 36]], dtype=float
    )
    assert leg_length(names, translations) == pytest.approx(78.0)


@pytest.fixture(scope="module")
def stand_idle(archive: Path) -> Clip:
    unit = archive / "raw" / "animations" / STAND_IDLE
    if not (unit / "done.json").is_file():
        pytest.skip("stand idle clip not exported")
    return Clip.load(unit)


def test_body_clip_glb_poses_the_target_skeleton_on_the_floor(
    bindings, archive: Path, stand_idle: Clip, tmp_path: Path
) -> None:
    target = Builder(archive, web_root=tmp_path / "web")._body_target()
    info = describe(STAND_IDLE, "body")
    output = tmp_path / "idle.glb"
    stats = convert_body_clip(stand_idle, target, info, output)
    assert 0.0 <= stats["lowest_foot_y_m"] < 0.04, "feet stay near the floor"
    document, binary = read_glb(output.read_bytes())
    animation = document["animations"][0]
    assert animation["name"] == "anim.stand_idle_loop"
    nodes = [document["nodes"][c["target"]["node"]]["name"] for c in animation["channels"]]
    assert "pelvis" in nodes and "hand_l" in nodes and "upperarm_bck_l" not in nodes
    times = accessor_values(document, binary, animation["samplers"][0]["input"])[:, 0]
    assert times[0] == 0.0 and times[-1] == pytest.approx(stand_idle.length, abs=1e-4)
    rotation = next(c for c in animation["channels"] if c["target"]["path"] == "rotation")
    keys = accessor_values(document, binary, animation["samplers"][rotation["sampler"]]["output"])
    np.testing.assert_allclose(np.linalg.norm(keys, axis=1), 1.0, atol=1e-4)
    retarget = document["scenes"][0]["extras"]["mh"]["retarget"]
    assert set(retarget["leg_lengths_m"]) == {"female", "male"} and retarget["target"] == "female"


def test_body_rig_reproduces_unreals_twist_joints(bindings, archive: Path, tmp_path: Path) -> None:
    """The body ROM clip is the one clip exported with Unreal's twist values."""
    unit = archive / "raw" / "animations" / BODY_ROM
    if not (unit / "done.json").is_file():
        pytest.skip("body ROM clip not exported")
    clip = Clip.load(unit)
    target = Builder(archive, web_root=tmp_path / "web")._body_target()
    assert target.rig is not None
    names = target.rig.dna.joints.names
    lower = {n.lower(): i for i, n in enumerate(names)}
    joint_of = np.array([lower[b.lower()] for b in clip.bones])
    data = clip.bone_data()[::40]
    _, rotations = unreal_to_dna_local(data[..., 0:3], data[..., 3:7])
    posed = driven_rotations(target.rig, rotations, joint_of)
    twists = [i for i, b in enumerate(clip.bones) if "_twist_" in b and "cor" not in b.lower()]
    ours = posed[:, joint_of[twists]]
    theirs = rotations[:, twists]
    error = np.degrees(2 * np.arccos(np.abs(np.sum(ours * theirs, axis=-1)).clip(0, 1)))
    assert np.median(error) < 0.1 and np.percentile(error, 95) < 1.0
