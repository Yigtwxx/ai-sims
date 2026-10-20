"""RigLogic evaluation and deformation tests, plus the pure kinematics they rely on.

Rig fixtures are the DNA files Unreal 5.8 ships (see `asset_pipeline.mh.engine`); those tests
skip without them or without the OpenRigLogic bindings (`scripts/build_openriglogic.py`).
Distances are in the DNA's centimetres.
"""

from pathlib import Path

import numpy as np
import pytest
from scipy.spatial import cKDTree
from scipy.spatial.transform import Rotation

from asset_pipeline.mh import engine
from asset_pipeline.mh.dna import Mesh, read_dna
from asset_pipeline.mh.kinematics import (
    ROTATION_SEQUENCES,
    compose_transforms,
    euler_to_quaternion,
    forward_kinematics,
    forward_kinematics_trs,
    quaternion_multiply,
    quaternion_to_matrix,
    topological_order,
)
from asset_pipeline.mh.openriglogic import is_available
from asset_pipeline.mh.rig import IDENTITY_DELTA, MetaHumanRig

JAW_OPEN = "CTRL_expressions.jawOpen"
requires_bindings = pytest.mark.skipif(
    not is_available(), reason="OpenRigLogic bindings not built (scripts/build_openriglogic.py)"
)


def engine_file(relative: Path) -> Path:
    path = engine.engine_dna(relative)
    if not path.is_file():
        pytest.skip(f"engine DNA not available: {path}")
    return path


@pytest.fixture(scope="module")
def head_rig() -> MetaHumanRig:
    if not is_available():
        pytest.skip("OpenRigLogic bindings not built")
    return MetaHumanRig(read_dna(engine_file(engine.ARCHETYPE_HEAD), lods=[0, 1]))


def sphere_centre(points: np.ndarray) -> np.ndarray:
    """Least-squares sphere fit."""
    system = np.c_[2 * points, np.ones(len(points))]
    return np.linalg.lstsq(system, (points**2).sum(axis=1), rcond=None)[0][:3]


def position_normals(mesh: Mesh) -> np.ndarray:
    normals = np.zeros(mesh.positions.shape)
    np.add.at(normals, mesh.layout_positions, mesh.normals[mesh.layout_normals])
    return normals / np.linalg.norm(normals, axis=1, keepdims=True)


# ---------------------------------------------------------------------------- kinematics


@pytest.mark.parametrize("sequence", ROTATION_SEQUENCES)
def test_euler_sequences_apply_the_first_axis_first(sequence):
    angles = np.radians([[30.0, -45.0, 70.0], [5.0, 120.0, -15.0]])
    expected = Rotation.from_euler(sequence, angles[:, ["xyz".index(a) for a in sequence]])
    got = euler_to_quaternion(angles, sequence)
    dots = np.abs(np.einsum("ij,ij->i", got, expected.as_quat()))
    np.testing.assert_allclose(dots, 1.0, atol=1e-12)


def test_rotation_signs_negate_their_axis():
    angles = np.radians([20.0, 30.0, 40.0])
    flipped = euler_to_quaternion(angles, "xyz", signs=(1, -1, 1))
    np.testing.assert_allclose(flipped, euler_to_quaternion(angles * [1, -1, 1], "xyz"))


def test_quaternion_product_applies_the_right_operand_first():
    a, b = Rotation.from_euler("x", 50, degrees=True), Rotation.from_euler("y", -35, degrees=True)
    product = quaternion_multiply(a.as_quat(), b.as_quat())
    np.testing.assert_allclose(quaternion_to_matrix(product), (a * b).as_matrix(), atol=1e-12)


def test_trs_and_matrix_kinematics_agree_without_non_uniform_scale():
    rng = np.random.default_rng(7)
    parents = np.array([-1, 0, 1, 1, 3])
    translations = rng.normal(size=(5, 3))
    rotations = Rotation.random(5, random_state=3).as_quat()
    scales = np.array([[1, 1, 1], [2, 2, 2], [1, 1, 1], [0.5, 0.5, 0.5], [1, 1, 1]], float)
    world = compose_transforms(*forward_kinematics_trs(translations, rotations, scales, parents))
    expected = forward_kinematics(compose_transforms(translations, rotations, scales), parents)
    np.testing.assert_allclose(world, expected, atol=1e-12)


def test_trs_kinematics_does_not_shear_under_non_uniform_parent_scale():
    parents = np.array([-1, 0])
    translations = np.array([[0.0, 0, 0], [1.0, 0, 0]])
    rotations = np.vstack([[0, 0, 0, 1], Rotation.from_euler("z", 45, degrees=True).as_quat()])
    scales = np.array([[2.0, 1, 1], [1.0, 1, 1]])
    t, _, s = forward_kinematics_trs(translations, rotations, scales, parents)
    np.testing.assert_allclose(t[1], [2.0, 0, 0])  # child offset scaled by the parent
    np.testing.assert_allclose(s[1], [2.0, 1, 1])  # scales multiply per axis
    child = compose_transforms(*forward_kinematics_trs(translations, rotations, scales, parents))[1]
    columns = child[:3, :3]
    assert abs(columns[:, 0] @ columns[:, 1]) < 1e-12, "matrix columns must stay orthogonal"
    sheared = forward_kinematics(compose_transforms(translations, rotations, scales), parents)[1]
    assert abs(sheared[:3, 0] @ sheared[:3, 1]) > 0.1, "matrix rule shears in this setup"


def test_topological_order_puts_parents_first_and_rejects_cycles():
    order = topological_order([2, -1, 1, 0])
    position = {joint: i for i, joint in enumerate(order)}
    assert position[1] < position[2] < position[0] < position[3]
    with pytest.raises(ValueError, match="cycle"):
        topological_order([1, 0])


# ---------------------------------------------------------------------------- neutral pose


@requires_bindings
def test_neutral_quaternions_are_the_dna_euler_angles(head_rig):
    dna = head_rig.dna
    descriptor = dna.descriptor
    expected = euler_to_quaternion(
        dna.joints.rotations * descriptor.radians_per_unit,
        descriptor.rotation_sequence,
        descriptor.rotation_signs,
    )
    dots = np.abs(np.einsum("ij,ij->i", expected, head_rig.neutral_rotations))
    np.testing.assert_allclose(dots, 1.0, atol=1e-6)
    np.testing.assert_allclose(head_rig.neutral_translations, dna.joints.translations, atol=1e-5)
    np.testing.assert_array_equal(head_rig.neutral_scales, 1.0)


@requires_bindings
@pytest.mark.parametrize(
    ("joint", "mesh"),
    [("FACIAL_L_Eye", "eyeLeft_lod0_mesh"), ("FACIAL_R_Eye", "eyeRight_lod0_mesh")],
)
def test_eye_joints_sit_at_the_eyeball_centres(head_rig, joint, mesh):
    """Checks the rotation convention and that joints and meshes share one model space."""
    position = head_rig.neutral_world_matrices[head_rig.dna.joints.index(joint), :3, 3]
    centre = sphere_centre(head_rig.dna.mesh(mesh).positions.astype(np.float64))
    assert np.linalg.norm(position - centre) < 0.05, f"{joint} at {position}, eyeball at {centre}"


@requires_bindings
def test_neutral_evaluation_is_the_identity_pose(head_rig):
    output = head_rig.evaluate()
    np.testing.assert_array_equal(output.joint_deltas, np.tile(IDENTITY_DELTA, (870, 1)))
    assert not output.blend_shape_weights.any()
    assert not output.animated_maps.any()
    assert not output.psd_controls.any()
    np.testing.assert_allclose(output.world_matrices, head_rig.neutral_world_matrices, atol=1e-9)
    for mesh in head_rig.dna.meshes_for_lod(0):
        moved = np.abs(head_rig.displacements(mesh.index, output)).max()
        assert moved < 1e-3, f"{mesh.name} moved {moved} cm in the neutral pose"


@requires_bindings
def test_rest_controls_are_riglogics_identity_driver_quaternions(head_rig):
    rest = head_rig.rest_controls()
    active = {head_rig.control_names[i]: rest[i] for i in np.flatnonzero(rest)}
    assert active == {"neck_01.qw": 1.0, "neck_02.qw": 1.0, "head.qw": 1.0}


# ---------------------------------------------------------------------------- expressions


@requires_bindings
def test_jaw_open_rotates_the_jaw_and_drops_the_chin(head_rig):
    dna = head_rig.dna
    jaw = dna.joints.index("FACIAL_C_Jaw")
    output = head_rig.evaluate({JAW_OPEN: 1.0})
    angle = np.degrees(2 * np.arccos(np.clip(output.joint_deltas[jaw, 6], -1, 1)))
    assert 15 < angle < 35, f"jaw opens by {angle:.1f} degrees"

    head = dna.mesh("head_lod0_mesh")
    positions = head.positions
    jaw_height = head_rig.neutral_world_matrices[jaw, 1, 3]
    midline = np.flatnonzero((np.abs(positions[:, 0]) < 0.3) & (positions[:, 1] < jaw_height - 4))
    chin = midline[np.argmax(positions[midline, 2])]
    moved = head_rig.displacements(head.index, output)
    # The chin swings down and back around the jaw hinge (measured: -2.5 cm, -1.8 cm).
    assert -4.0 < moved[chin, 1] < -1.5, f"chin moved {moved[chin]}"
    assert moved[chin, 2] < 0.0, f"chin moved {moved[chin]}"
    # A centred control must not push the chin sideways. Composing the deltas in the wrong
    # order (delta * neutral) shifts it by 0.9 mm; neutral * delta keeps it under 0.05 mm.
    assert abs(moved[chin, 0]) < 0.02, f"chin drifted sideways {moved[chin]}"
    nose = np.argmax(positions[:, 2])
    assert np.linalg.norm(moved[nose]) < 0.2, f"nose tip moved {moved[nose]}"


@requires_bindings
def test_eye_look_left_turns_the_left_eyeball_to_the_characters_left(head_rig):
    dna = head_rig.dna
    output = head_rig.evaluate({"CTRL_expressions.eyeLookLeftL": 1.0})
    left = dna.mesh("eyeLeft_lod0_mesh")
    cornea = np.argmax(left.positions[:, 2])
    moved = head_rig.displacements(left.index, output)
    assert moved[cornea, 0] > 0.5, f"cornea moved {moved[cornea]} (+x is the character's left)"
    # The eyeball turns rigidly about its joint.
    joint = output.joint_positions()[dna.joints.index("FACIAL_L_Eye")]
    neutral_joint = head_rig.neutral_world_matrices[dna.joints.index("FACIAL_L_Eye"), :3, 3]
    before = np.linalg.norm(left.positions - neutral_joint, axis=1)
    after = np.linalg.norm(head_rig.deform(left.index, output) - joint, axis=1)
    np.testing.assert_allclose(after, before, atol=1e-3)
    right = dna.mesh("eyeRight_lod0_mesh")
    assert np.abs(head_rig.displacements(right.index, output)).max() < 1e-3


@requires_bindings
@pytest.mark.parametrize(
    "control",
    [
        "mouthCornerPull", "mouthStretch", "mouthUpperLipRaise", "mouthDimple", "eyeBlink",
        "eyeCheekRaise", "browRaiseOuter", "noseWrinkle",
    ],
)  # fmt: skip
def test_mirrored_controls_give_mirrored_deltas(head_rig, control):
    """Large sided expressions mirror within 1-7 % in the archetype rig. Some low-amplitude
    lip controls (mouthLipsPress, mouthCornerSharpen*) are 30-50 % asymmetric in the rig data
    itself, independent of how the deltas are composed, so they are not listed."""
    head = head_rig.dna.mesh("head_lod0_mesh")
    positions = head.positions.astype(np.float64)
    distance, mirror = cKDTree(positions).query(positions * [-1, 1, 1])
    assert np.percentile(distance, 99) < 0.2, "the archetype head should be symmetric"

    left = head_rig.displacements(
        head.index, head_rig.evaluate({f"CTRL_expressions.{control}L": 1})
    )
    right = head_rig.displacements(
        head.index, head_rig.evaluate({f"CTRL_expressions.{control}R": 1})
    )
    expected = left[mirror] * [-1, 1, 1]
    magnitude = np.linalg.norm(right, axis=1)
    moving = magnitude > 0.01
    assert moving.sum() > 100, f"{control}R barely moves the head"
    error = np.linalg.norm(right - expected, axis=1)
    relative = np.sqrt((error[moving] ** 2).mean() / (magnitude[moving] ** 2).mean())
    assert relative < 0.1, f"{control}: mirrored RMS error {relative:.1%}"
    assert np.percentile(error, 99) < 0.1, f"{control}: p99 error {np.percentile(error, 99):.3f}"


@requires_bindings
def test_animated_maps_follow_their_controls(head_rig):
    output = head_rig.evaluate({"CTRL_expressions.browDownL": 1.0})
    names = head_rig.dna.behavior.animated_map_names
    active = {names[i]: output.animated_maps[i] for i in np.flatnonzero(output.animated_maps)}
    assert active == {
        "head_cm2_color.head_wm2_browsDown_L": 1.0,
        "head_wm2_normal.head_wm2_browsDown_L": 1.0,
    }


# ---------------------------------------------------------------------------- LODs and API


@requires_bindings
def test_lower_lods_drive_the_same_joints_identically(head_rig):
    full = head_rig.evaluate({JAW_OPEN: 1.0})
    reduced = head_rig.evaluate({JAW_OPEN: 1.0}, lod=1)
    active = head_rig.dna.joints.lod_joints[1]
    np.testing.assert_array_equal(reduced.joint_deltas[active], full.joint_deltas[active])
    idle = np.setdiff1d(np.arange(len(head_rig.joint_names)), active)
    np.testing.assert_array_equal(
        reduced.joint_deltas[idle], np.tile(IDENTITY_DELTA, (len(idle), 1))
    )


@requires_bindings
def test_lod1_head_deforms_like_lod0(head_rig):
    dna = head_rig.dna
    fine, coarse = dna.mesh("head_lod0_mesh"), dna.mesh("head_lod1_mesh")
    fine_moved = head_rig.displacements(fine.index, head_rig.evaluate({JAW_OPEN: 1.0}))
    coarse_moved = head_rig.displacements(coarse.index, head_rig.evaluate({JAW_OPEN: 1.0}, lod=1))
    # Match each coarse vertex to a nearby fine vertex on the same side of the lip seam.
    distance, candidates = cKDTree(fine.positions).query(coarse.positions, k=8)
    facing = np.einsum("ij,ikj->ik", position_normals(coarse), position_normals(fine)[candidates])
    pick = np.argmax(facing > 0.7, axis=1)
    matched = distance[np.arange(len(pick)), pick] < 0.2
    partner = candidates[np.arange(len(pick)), pick]
    assert matched.mean() > 0.85
    error = np.linalg.norm(coarse_moved - fine_moved[partner], axis=1)[matched]
    magnitude = np.linalg.norm(coarse_moved, axis=1)[matched]
    moving = magnitude > 0.05
    relative = np.sqrt((error[moving] ** 2).mean() / (magnitude[moving] ** 2).mean())
    assert relative < 0.05, f"LOD1 jaw-open differs from LOD0 by {relative:.1%} RMS"


@requires_bindings
def test_evaluations_do_not_leak_state(head_rig):
    first = head_rig.evaluate({JAW_OPEN: 1.0, "CTRL_expressions.eyeBlinkL": 1.0})
    head_rig.evaluate({"CTRL_expressions.mouthCornerPullR": 1.0}, lod=1)
    again = head_rig.evaluate({JAW_OPEN: 1.0, "CTRL_expressions.eyeBlinkL": 1.0})
    np.testing.assert_array_equal(again.joint_deltas, first.joint_deltas)
    np.testing.assert_array_equal(again.animated_maps, first.animated_maps)
    np.testing.assert_array_equal(head_rig.evaluate().joint_deltas[:, 6], 1.0)


@requires_bindings
def test_control_names_match_unreal_curve_spelling(head_rig):
    index = head_rig.control_index(JAW_OPEN)
    assert head_rig.control_index("CTRL_expressions_jawOpen") == index
    assert head_rig.control_index("ctrl_expressions_jawopen") == index
    with pytest.raises(KeyError, match=r"CTRL_expressions\.jawOpen"):
        head_rig.control_index("CTRL_expressions.jawOpn")


@requires_bindings
def test_deform_rejects_meshes_of_another_lod(head_rig):
    with pytest.raises(ValueError, match="LOD 1 mesh"):
        head_rig.deform("head_lod1_mesh", head_rig.evaluate())
    with pytest.raises(ValueError, match="LOD 8"):
        head_rig.evaluate(lod=8)


# ---------------------------------------------------------------------------- other rigs


@requires_bindings
def test_blend_shape_control_moves_the_body_model_by_its_target():
    model = read_dna(engine_file(engine.BODY_MODEL), blend_shapes={0})
    rig = MetaHumanRig(model)
    output = rig.evaluate({"local_back_0": 1.0})
    assert np.flatnonzero(output.blend_shape_weights).tolist() == [0]
    mesh = model.mesh(0)
    (target,) = mesh.blend_shapes
    expected = np.zeros(mesh.positions.shape)
    expected[target.vertices] = target.deltas
    np.testing.assert_allclose(rig.displacements(0, output), expected, atol=1e-3)
    assert np.abs(target.deltas).max() > 1.0, "Shape_0 should visibly move the body"


@requires_bindings
def test_unit_rig_applies_blend_shape_deltas_exactly():
    unit = read_dna(engine_file(engine.RIGLOGIC_UNIT_TEST))
    rig = MetaHumanRig(unit)
    output = rig.evaluate({"R.G": 1.0})
    channel = unit.behavior.blend_shape_channel_names.index("BG")
    assert output.blend_shape_weights[channel] == 1.0
    shaped = rig.deform("MA", output, skinning=False)
    np.testing.assert_allclose(shaped[:, 0], [14.0, 16.0, 18.0])  # (7, 8, 9) + delta (7, 8, 9)


@requires_bindings
def test_body_rig_rests_at_identity_and_rejects_zero_quaternions():
    body = MetaHumanRig(read_dna(engine_file(engine.ARCHETYPE_COMBINED_BODY), geometry=False))
    rest = body.evaluate()
    np.testing.assert_array_equal(
        rest.joint_deltas, np.tile(IDENTITY_DELTA, (len(body.joint_names), 1))
    )
    with pytest.raises(ValueError, match="unit quaternions"):
        body.evaluate_raw(np.zeros(body.control_count))
