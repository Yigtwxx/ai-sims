"""DNA reader tests.

Fixtures are the DNA files Unreal 5.8 ships (see `asset_pipeline.mh.engine`); tests that need
them or the OpenRigLogic bindings (`scripts/build_openriglogic.py`) skip when absent.
"""

from itertools import pairwise
from pathlib import Path

import numpy as np
import pytest

from asset_pipeline.mh import engine
from asset_pipeline.mh.dna import (
    CoordinateSystem,
    DnaFile,
    DnaReadError,
    SkinWeights,
    _triangulate,
    read_dna,
)
from asset_pipeline.mh.openriglogic import is_available

requires_bindings = pytest.mark.skipif(
    not is_available(), reason="OpenRigLogic bindings not built (scripts/build_openriglogic.py)"
)


def engine_file(relative: Path) -> Path:
    path = engine.engine_dna(relative)
    if not path.is_file():
        pytest.skip(f"engine DNA not available: {path}")
    return path


@pytest.fixture(scope="module")
def head() -> DnaFile:
    if not is_available():
        pytest.skip("OpenRigLogic bindings not built")
    return read_dna(engine_file(engine.ARCHETYPE_HEAD))


@pytest.fixture(scope="module")
def unit_rig() -> DnaFile:
    if not is_available():
        pytest.skip("OpenRigLogic bindings not built")
    return read_dna(engine_file(engine.RIGLOGIC_UNIT_TEST))


# ---------------------------------------------------------------------------- pure helpers


def test_metahuman_axes_are_right_handed_and_match_gltf():
    system = CoordinateSystem(x="left", y="up", z="front")
    assert system.valid
    assert system.right_handed
    np.testing.assert_array_equal(system.basis(), np.eye(3))


def test_mirrored_and_uninitialised_coordinate_systems_are_flagged():
    mirrored = CoordinateSystem(x="right", y="up", z="front")
    assert mirrored.valid
    assert not mirrored.right_handed
    assert not CoordinateSystem(x="left", y="left", z="left").valid


def test_fan_triangulation_keeps_polygon_winding():
    offsets = np.array([0, 4, 7, 12])
    layouts = np.array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], dtype=np.int32)
    triangles, faces = _triangulate(offsets, layouts)
    np.testing.assert_array_equal(
        triangles,
        [[0, 1, 2], [0, 2, 3], [4, 5, 6], [7, 8, 9], [7, 9, 10], [7, 10, 11]],
    )
    np.testing.assert_array_equal(faces, [0, 0, 1, 2, 2, 2])


def test_dense_skin_weights_sort_truncate_and_renormalise():
    skin = SkinWeights(
        offsets=np.array([0, 3, 4, 4]),
        joints=np.array([5, 6, 7, 2], dtype=np.int32),
        weights=np.array([0.2, 0.5, 0.3, 2.0], dtype=np.float32),
        max_influences=3,
    )
    joints, weights = skin.dense()
    np.testing.assert_array_equal(joints, [[6, 7, 5], [2, 0, 0], [0, 0, 0]])
    np.testing.assert_allclose(weights, [[0.5, 0.3, 0.2], [1, 0, 0], [0, 0, 0]], atol=1e-7)

    joints, weights = skin.dense(influences=2)
    np.testing.assert_array_equal(joints[0], [6, 7])
    np.testing.assert_allclose(weights[0], [0.625, 0.375], atol=1e-7)

    _, raw = skin.dense(influences=4, normalize=False)
    assert raw.shape == (3, 4)
    np.testing.assert_allclose(raw[1], [2.0, 0, 0, 0])


# ---------------------------------------------------------------------------- archetype head


@requires_bindings
def test_head_descriptor_records_units_and_axes(head):
    descriptor = head.descriptor
    assert descriptor.translation_unit == "cm"
    assert descriptor.meters_per_unit == 0.01
    assert descriptor.rotation_unit == "degrees"
    assert descriptor.rotation_sequence == "xyz"
    assert descriptor.rotation_signs == (1, 1, 1)
    assert descriptor.coordinate_system == CoordinateSystem("left", "up", "front")
    assert descriptor.face_winding == "ccw"
    assert descriptor.file_format == (2, 5)
    assert descriptor.lod_count == len(head.lod_meshes) == 8


@requires_bindings
def test_head_meshes_follow_the_lod_naming(head):
    for lod, indices in enumerate(head.lod_meshes):
        assert indices, f"LOD {lod} has no meshes"
        for index in indices:
            assert head.mesh_names[index].endswith(f"_lod{lod}_mesh")
            assert head.lod_of_mesh(index) == lod
    lod0 = {head.mesh_names[i].removesuffix("_lod0_mesh") for i in head.lod_meshes[0]}
    assert lod0 == {
        "head", "teeth", "saliva", "eyeLeft", "eyeRight", "eyeshell", "eyelashes",
        "eyeEdge", "cartilage",
    }  # fmt: skip
    face = head.mesh("head_lod0_mesh")
    assert (len(face.positions), face.layout_count, face.face_count) == (24049, 24408, 24002)
    assert np.all(np.diff(face.face_offsets) == 4)  # the head is all quads


@requires_bindings
def test_head_triangles_wind_counter_clockwise_around_stored_normals(head):
    for mesh in head.meshes_for_lod(0):
        sizes = np.diff(mesh.face_offsets)
        assert len(mesh.triangles) == int((sizes - 2).sum())
        corners = mesh.positions[mesh.layout_positions[mesh.triangles]]
        face_normals = np.cross(corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0])
        stored = mesh.normals[mesh.layout_normals[mesh.triangles]].sum(axis=1)
        agree = np.mean(np.einsum("ij,ij->i", face_normals, stored) > 0)
        assert agree > 0.99, mesh.name


@requires_bindings
def test_head_attributes_are_well_formed(head):
    for mesh in head.meshes.values():
        np.testing.assert_allclose(np.linalg.norm(mesh.normals, axis=1), 1.0, atol=1e-4)
        assert mesh.uvs.min() >= 0.0 and mesh.uvs.max() <= 1.0, mesh.name
        assert np.unique(mesh.layout_positions).size == len(mesh.positions), mesh.name


@requires_bindings
def test_head_skin_weights_are_normalised_and_use_lod_joints(head):
    for lod, indices in enumerate(head.lod_meshes):
        lod_joints = set(head.joints.lod_joints[lod].tolist())
        for index in indices:
            skin = head.meshes[index].skin
            counts = np.diff(skin.offsets)
            assert counts.min() >= 1 and counts.max() <= skin.max_influences
            totals = np.add.reduceat(skin.weights, skin.offsets[:-1])
            np.testing.assert_allclose(totals, 1.0, atol=1e-5)
            # Facial joints a mesh uses are driven in its LOD. Body joints at the neck seam
            # (spine_04, clavicles, neck, head) are skinned but posed by the body skeleton.
            outside = set(np.unique(skin.joints).tolist()) - lod_joints
            facial = [head.joints.names[j] for j in outside if "FACIAL_" in head.joints.names[j]]
            assert not facial, f"{head.mesh_names[index]}: undriven facial joints {facial}"


@requires_bindings
def test_head_joint_hierarchy_and_lods(head):
    joints = head.joints
    assert len(joints) == 870
    assert joints.names[0] == "spine_04"
    assert joints.parents[0] == -1
    assert np.all(joints.parents[1:] >= 0)
    assert np.all(joints.parents[1:] < np.arange(1, len(joints)))  # parents come first
    assert joints.index("FACIAL_C_Jaw") == joints.names.index("FACIAL_C_Jaw")
    np.testing.assert_allclose(
        joints.rotations[joints.index("FACIAL_C_Jaw")], [40, 0, 0], atol=1e-4
    )
    sets = [set(lod.tolist()) for lod in joints.lod_joints]
    for lod, (finer, coarser) in enumerate(pairwise(sets)):
        assert finer >= coarser, f"LOD {lod + 1} joints are not a subset of LOD {lod} joints"
    with pytest.raises(KeyError, match="FACIAL_C_Jaw"):
        joints.index("FACIAL_C_jaw")


@requires_bindings
def test_head_behavior_exposes_controls_psds_and_maps(head):
    behavior = head.behavior
    raw = behavior.raw_control_names
    assert len(raw) == 263
    assert "CTRL_expressions.jawOpen" in raw
    drivers = [name for name in raw if not name.startswith("CTRL_")]
    assert drivers == [f"{j}.q{c}" for j in ("neck_01", "neck_02", "head") for c in "xyzw"]
    assert "CTRL_C_jaw.ty" in behavior.gui_control_names
    assert behavior.psds.count == 545
    psd_inputs = len(raw) + behavior.psds.count
    assert behavior.psds.rows.min() >= len(raw) and behavior.psds.rows.max() < psd_inputs
    # PSDs also combine RBF pose outputs, which come last in RigLogic's input vector.
    assert len(behavior.rbf_pose_control_names) == 18
    assert behavior.input_count == psd_inputs + 18
    assert psd_inputs <= behavior.psds.columns.max() < behavior.input_count
    assert len(behavior.animated_map_names) == 82
    assert "head_cm2_color.head_wm2_browsDown_L" in behavior.animated_map_names
    assert behavior.blend_shape_channel_names == ()  # the archetype rig is joint-only
    assert behavior.rbf_solver_names == ("neckCorr_f_med_nrw_UERBFSolver",)


@requires_bindings
def test_lod_and_geometry_filters():
    path = engine_file(engine.ARCHETYPE_HEAD)
    lod1 = read_dna(path, lods=[1])
    assert set(lod1.meshes) == set(lod1.lod_meshes[1])
    with pytest.raises(KeyError, match="not read"):
        lod1.mesh("head_lod0_mesh")
    bare = read_dna(path, geometry=False)
    assert not bare.meshes
    assert len(bare.joints) == 870
    with pytest.raises(ValueError, match="LOD 8"):
        read_dna(path, lods=[8])


# ---------------------------------------------------------------------------- other fixtures


@requires_bindings
def test_unit_rig_values_are_read_exactly(unit_rig):
    descriptor = unit_rig.descriptor
    assert (descriptor.translation_unit, descriptor.rotation_unit) == ("m", "radians")
    assert descriptor.coordinate_system == CoordinateSystem("right", "up", "front")
    np.testing.assert_array_equal(unit_rig.joints.parents, [-1, 0, 0, 1, 1, 4, 2, 6, 2])
    np.testing.assert_array_equal(unit_rig.joints.translations[3], [4, 4, 4])

    mesh = unit_rig.mesh("MA")
    np.testing.assert_array_equal(mesh.positions, [[7, 7, 7], [8, 8, 8], [9, 9, 9]])
    np.testing.assert_array_equal(mesh.triangles, [[0, 1, 2]])
    (target,) = mesh.blend_shapes
    assert unit_rig.behavior.blend_shape_channel_names[target.channel] == "BG"
    np.testing.assert_array_equal(target.vertices, [0, 1, 2])
    np.testing.assert_array_equal(target.deltas[:, 0], [7, 8, 9])
    np.testing.assert_array_equal(mesh.skin.joints[:3], [0, 1, 2])
    np.testing.assert_array_equal(mesh.skin.weights[:3], [7, 8, 9])  # stored unnormalised


@requires_bindings
def test_blend_shape_filter_and_uninitialised_descriptor():
    path = engine_file(engine.BODY_MODEL)
    model = read_dna(path, blend_shapes={0})
    assert not model.descriptor.coordinate_system.valid
    (mesh,) = model.meshes.values()
    assert [target.channel for target in mesh.blend_shapes] == [0]
    assert model.behavior.blend_shape_channel_names[0] == "Shape_0"
    assert len(model.behavior.blend_shape_channel_names) == 379
    assert not read_dna(path, blend_shapes=False).mesh(0).blend_shapes


@requires_bindings
def test_unreadable_files_raise(tmp_path):
    with pytest.raises(DnaReadError, match="not found"):
        read_dna(tmp_path / "missing.dna")
    garbage = tmp_path / "garbage.dna"
    garbage.write_bytes(b"definitely not a DNA file")
    with pytest.raises(DnaReadError, match="signature"):
        read_dna(garbage)
