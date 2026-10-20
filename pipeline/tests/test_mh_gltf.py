"""GLB writer invariants: synthetic DNAs (no bindings needed) and Ada's converted files."""

import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest
from scipy.spatial.transform import Rotation

from asset_pipeline.mh.arkit import ARKIT_NAMES
from asset_pipeline.mh.bake import MeshMorph, MorphTarget, ShapeSpec
from asset_pipeline.mh.convert import convert_body, convert_head
from asset_pipeline.mh.dna import (
    Behavior,
    ConditionalTable,
    CoordinateSystem,
    Descriptor,
    DnaFile,
    Joints,
    Mesh,
    Psds,
    SkinWeights,
    _triangulate,
)
from asset_pipeline.mh.glb import (
    MESHOPT,
    QUANTIZATION,
    accessor_array,
    accessor_values,
    read_glb,
)
from asset_pipeline.mh.gltf import Space, merge_influences, write_glb
from asset_pipeline.mh.kinematics import (
    compose_transforms,
    forward_kinematics,
    matrix_to_quaternion,
    quaternion_to_matrix,
)
from asset_pipeline.mh.seams import boundary_loops, neck_seam
from asset_pipeline.mh.visemes import VISEME_NAMES

ITEM_SIZE = {5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
PIPELINE = Path(__file__).resolve().parents[1]
WEB = PIPELINE.parent / "web"
WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


# ---------------------------------------------------------------------------- synthetic DNA


def _ints(*values: int) -> np.ndarray:
    return np.array(values, dtype=np.int32)


def _empty_table() -> ConditionalTable:
    empty_f, empty_i = np.zeros(0, np.float32), np.zeros(0, np.int32)
    return ConditionalTable(empty_i, empty_i, empty_f, empty_f, empty_f, empty_f)


def _behavior() -> Behavior:
    empty_i = np.zeros(0, np.int32)
    return Behavior(
        gui_control_names=(),
        raw_control_names=(),
        gui_to_raw=_empty_table(),
        psds=Psds(0, empty_i, empty_i, np.zeros(0, np.float32)),
        blend_shape_channel_names=(),
        blend_shape_lods=empty_i,
        blend_shape_inputs=empty_i,
        blend_shape_outputs=empty_i,
        lod_blend_shape_channels=(empty_i,),
        animated_map_names=(),
        animated_map_lods=empty_i,
        animated_maps=_empty_table(),
        lod_animated_maps=(empty_i,),
        joint_group_count=0,
        rbf_solver_names=(),
        rbf_pose_names=(),
        rbf_pose_control_names=(),
        ml_control_names=(),
        joint_group_joints=empty_i,
        twist_swing_joints=empty_i,
    )


def synthetic_dna(system: tuple[str, str, str] = ("left", "up", "front")) -> DnaFile:
    """Two quads (positions 0-5) with a UV seam (layouts 6, 7) on a 3-joint chain."""
    positions = np.array(
        [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0], [20, 0, 0], [20, 10, 0]], np.float32
    )
    face_layouts = _ints(0, 1, 2, 3, 6, 4, 5, 7)
    face_offsets = np.array([0, 4, 8], dtype=np.int64)
    triangles, triangle_faces = _triangulate(face_offsets, face_layouts)
    skin = [
        [(0, 1.0)], [(0, 0.5), (1, 0.5)], [(1, 1.0)],
        [(0, 0.7), (1, 0.3)], [(1, 0.6), (2, 0.4)], [(2, 1.0)],
    ]  # fmt: skip
    mesh = Mesh(
        index=0,
        name="head_lod0_mesh",
        positions=positions,
        normals=np.tile(np.array([0, 0, 1], np.float32), (6, 1)),
        uvs=np.array(
            [[0, 0], [0.5, 0], [0.5, 1], [0, 1], [1, 0], [1, 1], [0.6, 0], [0.6, 1]], np.float32
        ),
        layout_positions=_ints(0, 1, 2, 3, 4, 5, 1, 2),
        layout_uvs=_ints(0, 1, 2, 3, 4, 5, 6, 7),
        layout_normals=_ints(0, 1, 2, 3, 4, 5, 1, 2),
        face_offsets=face_offsets,
        face_layouts=face_layouts,
        triangles=triangles,
        triangle_faces=triangle_faces,
        skin=SkinWeights(
            offsets=np.cumsum([0] + [len(v) for v in skin]).astype(np.int64),
            joints=_ints(*(j for v in skin for j, _ in v)),
            weights=np.array([w for v in skin for _, w in v], np.float32),
            max_influences=2,
        ),
        blend_shapes=(),
    )
    descriptor = Descriptor(
        name="synthetic", archetype="other", gender="female", age=30, metadata={},
        translation_unit="cm", rotation_unit="degrees",
        coordinate_system=CoordinateSystem(*system), rotation_sequence="xyz",
        rotation_signs=(1, 1, 1), face_winding="ccw", lod_count=1, db_max_lod=0,
        db_complexity="", db_name="", file_format=(2, 5),
    )  # fmt: skip
    joints = Joints(
        names=("root", "child", "leaf"),
        parents=_ints(-1, 0, 1),
        translations=np.array([[0, 0, 0], [0, 10, 0], [5, 0, 0]], np.float64),
        rotations=np.array([[0, 0, 0], [0, 0, 90], [10, 0, 0]], np.float64),
        lod_joints=(_ints(0, 1, 2),),
    )
    return DnaFile(
        path=Path("synthetic.dna"),
        descriptor=descriptor,
        joints=joints,
        behavior=_behavior(),
        mesh_names=("head_lod0_mesh",),
        lod_meshes=((0,),),
        meshes={0: mesh},
    )


def synthetic_targets() -> list[MorphTarget]:
    deltas = np.zeros((6, 3))
    deltas[[4, 5], 2] = 2.0  # lift the second quad's far edge by 2 cm
    lift = MeshMorph(positions=deltas, normals=np.zeros((6, 3)))
    return [
        MorphTarget("lift", ShapeSpec({}), {0: lift}, {}),
        MorphTarget("noop", ShapeSpec({}), {}, {}),
    ]


@pytest.fixture
def written(tmp_path):
    """Plain float GLB with sparse morph targets (`compress=False`)."""
    dna = synthetic_dna()
    path = tmp_path / "synthetic.glb"
    write_glb(path, dna, [0], targets=synthetic_targets(), extras={"kind": "head"}, compress=False)
    document, binary = read_glb(path.read_bytes())
    return dna, document, binary


@pytest.fixture
def compressed(tmp_path, monkeypatch):
    """The default GLB: quantized attributes and meshopt-compressed views (every view,
    however small, so the tiny synthetic mesh exercises the codec)."""
    monkeypatch.setattr("asset_pipeline.mh.glb.MIN_COMPRESSED_BYTES", 0)
    dna = synthetic_dna()
    path = tmp_path / "compressed.glb"
    write_glb(path, dna, [0], targets=synthetic_targets(), extras={"kind": "head"})
    document, binary = read_glb(path.read_bytes())
    return dna, document, binary


def primitive_array(document, binary, attribute: str, primitive: int = 0) -> np.ndarray:
    accessor = document["meshes"][0]["primitives"][primitive]["attributes"][attribute]
    return accessor_array(document, binary, accessor)


def primitive_values(document, binary, attribute: str, primitive: int = 0) -> np.ndarray:
    accessor = document["meshes"][0]["primitives"][primitive]["attributes"][attribute]
    return accessor_values(document, binary, accessor)


# ---------------------------------------------------------------------------- synthetic tests


def test_round_trip_unwelds_layouts_into_metres(written):
    dna, document, binary = written
    mesh = dna.mesh(0)
    positions = primitive_array(document, binary, "POSITION")
    np.testing.assert_allclose(positions, mesh.positions[mesh.layout_positions] * 0.01, atol=1e-7)
    uvs = primitive_array(document, binary, "TEXCOORD_0")
    np.testing.assert_allclose(uvs[:, 1], 1.0 - mesh.uvs[mesh.layout_uvs][:, 1])
    dna_index = primitive_array(document, binary, "_DNA_POSITION")[:, 0]
    np.testing.assert_array_equal(dna_index, mesh.layout_positions)
    primitive = document["meshes"][0]["primitives"][0]
    indices = accessor_array(document, binary, primitive["indices"]).reshape(-1, 3)
    np.testing.assert_array_equal(indices, mesh.triangles)
    assert document["materials"][primitive["material"]]["name"] == "head"


def test_accessors_fit_their_views_and_report_exact_bounds(written):
    _, document, binary = written
    for view in document["bufferViews"]:
        assert view["byteOffset"] % 4 == 0
        assert view["byteOffset"] + view["byteLength"] <= len(binary)
    for accessor in document["accessors"]:
        size = ITEM_SIZE[accessor["componentType"]] * WIDTH[accessor["type"]]
        if "bufferView" in accessor:
            view = document["bufferViews"][accessor["bufferView"]]
            assert accessor["count"] * size <= view["byteLength"]
    positions = primitive_array(document, binary, "POSITION")
    accessor = document["accessors"][
        document["meshes"][0]["primitives"][0]["attributes"]["POSITION"]
    ]
    assert accessor["min"] == positions.min(axis=0).tolist()
    assert accessor["max"] == positions.max(axis=0).tolist()


def test_morph_targets_are_named_sparse_and_bounded(written):
    dna, document, binary = written
    mesh = document["meshes"][0]
    assert mesh["extras"]["targetNames"] == ["lift", "noop"]
    assert mesh["weights"] == [0.0, 0.0]
    targets = mesh["primitives"][0]["targets"]
    lift = accessor_array(document, binary, targets[0]["POSITION"])
    expected = np.zeros((8, 3))
    expected[np.isin(dna.mesh(0).layout_positions, [4, 5]), 2] = 0.02
    np.testing.assert_allclose(lift, expected, atol=1e-7)
    lift_accessor = document["accessors"][targets[0]["POSITION"]]
    assert lift_accessor["sparse"]["count"] == 2
    assert lift_accessor["min"] == [0.0, 0.0, 0.0]
    assert lift_accessor["max"][2] == pytest.approx(0.02)
    noop = document["accessors"][targets[1]["POSITION"]]
    assert "bufferView" not in noop and "sparse" not in noop and noop["max"] == [0.0] * 3


def test_skin_binds_every_joint_at_the_neutral_pose(written):
    dna, document, binary = written
    skin = document["skins"][0]
    assert [document["nodes"][i]["name"] for i in skin["joints"]] == ["root", "child", "leaf"]
    nodes = [document["nodes"][i] for i in skin["joints"]]
    local = compose_transforms(
        [n["translation"] for n in nodes], [n["rotation"] for n in nodes], np.ones((3, 3))
    )
    world = forward_kinematics(local, dna.joints.parents)
    inverse = accessor_array(document, binary, skin["inverseBindMatrices"]).reshape(3, 4, 4)
    inverse = np.transpose(inverse, (0, 2, 1))  # stored column-major
    np.testing.assert_allclose(inverse @ world, np.tile(np.eye(4), (3, 1, 1)), atol=1e-6)
    np.testing.assert_allclose(world[1, :3, 3], [0, 0.1, 0], atol=1e-9)  # cm -> m
    weights = primitive_array(document, binary, "WEIGHTS_0")
    joints = primitive_array(document, binary, "JOINTS_0")
    np.testing.assert_allclose(weights.sum(axis=1), 1.0, atol=1e-6)
    assert joints.max() < 3 and np.all(joints[weights == 0] == 0)


def test_static_joints_hand_their_weight_to_live_ancestors(tmp_path):
    dna = synthetic_dna()
    path = tmp_path / "merged.glb"
    write_glb(path, dna, [0], live_joint=lambda name: name != "child", compress=False)
    document, binary = read_glb(path.read_bytes())
    joints = primitive_array(document, binary, "JOINTS_0")
    weights = primitive_array(document, binary, "WEIGHTS_0")
    assert not np.any((joints == 1) & (weights > 0)), "child must not keep weight"
    layout_of_position_2 = 2
    assert joints[layout_of_position_2, 0] == 0 and weights[layout_of_position_2, 0] == 1.0
    assert document["scenes"][0]["extras"]["mh"]["skin"]["live_joints"] == ["root", "leaf"]


def test_mirrored_dna_axes_flip_the_winding(tmp_path):
    dna = synthetic_dna(system=("right", "up", "front"))
    assert Space.from_descriptor(dna.descriptor).mirrors
    path = tmp_path / "mirrored.glb"
    write_glb(path, dna, [0])
    document, binary = read_glb(path.read_bytes())
    positions = primitive_array(document, binary, "POSITION")
    normals = primitive_values(document, binary, "NORMAL")
    np.testing.assert_allclose(
        positions[:, 0], -dna.mesh(0).positions[dna.mesh(0).layout_positions][:, 0] * 0.01
    )
    indices = accessor_array(document, binary, document["meshes"][0]["primitives"][0]["indices"])
    corners = positions[indices.reshape(-1, 3)]
    face = np.cross(corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0])
    assert np.all(np.einsum("ij,ij->i", face, normals[indices.reshape(-1, 3)[:, 0]]) > 0)


def test_compressed_glb_matches_the_plain_one_within_quantization(written, compressed):
    _, plain, plain_binary = written
    _, packed, packed_binary = compressed
    for attribute, tolerance in (
        ("POSITION", 0.0),
        ("_DNA_POSITION", 0.0),
        ("NORMAL", 1.0 / 32767),
        ("TEXCOORD_0", 0.5 / 65535),
        ("WEIGHTS_0", 1.0 / 65535),
    ):
        expected = primitive_values(plain, plain_binary, attribute)
        actual = primitive_values(packed, packed_binary, attribute)
        np.testing.assert_allclose(actual, expected, atol=tolerance + 1e-7, err_msg=attribute)
    weights = primitive_values(packed, packed_binary, "WEIGHTS_0")
    raw = primitive_array(packed, packed_binary, "WEIGHTS_0").astype(np.int64)
    assert np.all(raw.sum(axis=1) == 65535), "quantized weights must sum to exactly one"
    np.testing.assert_allclose(weights.sum(axis=1), 1.0, atol=1e-9)
    for index in range(2):
        expected = accessor_values(
            plain, plain_binary, plain["meshes"][0]["primitives"][0]["targets"][index]["POSITION"]
        )
        actual = accessor_values(
            packed,
            packed_binary,
            packed["meshes"][0]["primitives"][0]["targets"][index]["POSITION"],
        )
        np.testing.assert_allclose(actual, expected, atol=0.5 / 32767 + 1e-9)


def test_compressed_glb_declares_and_lays_out_its_extensions(compressed):
    _, document, _ = compressed
    assert {MESHOPT, QUANTIZATION} <= set(document["extensionsRequired"])
    fallback = document["buffers"][1]
    assert fallback["extensions"][MESHOPT] == {"fallback": True} and "uri" not in fallback
    packed = [v for v in document["bufferViews"] if MESHOPT in v.get("extensions", {})]
    assert packed, "vertex streams are meshopt-compressed"
    for view in packed:
        meshopt = view["extensions"][MESHOPT]
        assert view["buffer"] == 1 and meshopt["buffer"] == 0
        assert meshopt["mode"] == "ATTRIBUTES" and meshopt["byteStride"] % 4 == 0
        assert view["byteLength"] == meshopt["count"] * meshopt["byteStride"]
        if "byteStride" in view:
            assert view["byteStride"] == meshopt["byteStride"]
    normal = document["accessors"][document["meshes"][0]["primitives"][0]["attributes"]["NORMAL"]]
    assert normal["componentType"] == 5122 and normal["normalized"] is True
    assert document["bufferViews"][normal["bufferView"]]["byteStride"] == 8
    indices = document["accessors"][document["meshes"][0]["primitives"][0]["indices"]]
    assert MESHOPT not in document["bufferViews"][indices["bufferView"]].get("extensions", {})


def test_uvs_in_one_tile_move_to_the_unit_square(tmp_path):
    dna = synthetic_dna()
    mesh = dna.mesh(0)
    shifted = Mesh(**{**mesh.__dict__, "uvs": mesh.uvs + np.float32(1.0)})
    dna = DnaFile(**{**dna.__dict__, "meshes": {0: shifted}})
    path = tmp_path / "tile.glb"
    write_glb(path, dna, [0])
    document, binary = read_glb(path.read_bytes())
    uvs = primitive_values(document, binary, "TEXCOORD_0")
    np.testing.assert_allclose(uvs[:, 0], mesh.uvs[mesh.layout_uvs][:, 0], atol=1e-4)
    assert document["scenes"][0]["extras"]["mh"]["uv_tile_offset"] == {"head": [-1, -1]}


def test_merge_influences_keeps_the_four_strongest():
    joints = np.array([[0, 1, 2, 3, 4, 5]], dtype=np.int32)
    weights = np.array([[0.3, 0.25, 0.2, 0.1, 0.1, 0.05]], dtype=np.float32)
    identity = np.arange(6, dtype=np.int32)
    out_joints, out_weights, dropped = merge_influences(joints, weights, identity)
    assert out_joints.tolist() == [[0, 1, 2, 3]] or out_joints.tolist() == [[0, 1, 2, 4]]
    assert out_weights.sum() == pytest.approx(1.0, abs=1e-7)
    assert dropped == pytest.approx(0.15, abs=1e-6)
    merged = np.array([0, 0, 0, 3, 3, 3], dtype=np.int32)  # 1, 2 -> 0 and 4, 5 -> 3
    out_joints, out_weights, dropped = merge_influences(joints, weights, merged)
    assert out_joints.tolist() == [[0, 3, 0, 0]] and dropped == 0.0
    np.testing.assert_allclose(out_weights, [[0.75, 0.25, 0.0, 0.0]], atol=1e-7)


def test_matrix_to_quaternion_inverts_quaternion_to_matrix():
    rotations = Rotation.random(200, random_state=11)
    flips = Rotation.from_euler("xyz", np.diag([180.0, 180.0, 180.0]), degrees=True)  # trace -1
    matrices = np.concatenate([rotations.as_matrix(), flips.as_matrix()])
    np.testing.assert_allclose(
        quaternion_to_matrix(matrix_to_quaternion(matrices)), matrices, atol=1e-12
    )


def test_neck_seam_walks_the_open_boundary(written):
    dna = synthetic_dna()
    mesh = dna.mesh(0)
    (loop,) = boundary_loops(mesh)
    assert sorted(loop.tolist()) == [0, 1, 2, 3, 4, 5]
    seam = neck_seam(mesh, Space.from_descriptor(dna.descriptor), lowest=True, rings=1)
    assert seam["boundary"] == loop.tolist()
    assert all(weight == 1.0 for weight in seam["weights"])
    assert sorted(seam["vertices"]) == list(range(8))  # every layout of a seam position


# ---------------------------------------------------------------------------- converted files


@pytest.fixture(scope="session")
def ada_head_glb(bindings, archive, tmp_path_factory):
    web = tmp_path_factory.mktemp("web")
    result = convert_head("Ada", archive, web_root=web, head_maps=False)
    return result.stats, *read_glb(result.stats.path.read_bytes())


def test_head_glb_follows_the_asset_contract(ada_head_glb, ada_rig):
    _, document, _ = ada_head_glb
    names = document["meshes"][0]["extras"]["targetNames"]
    assert names == [*ARKIT_NAMES, *(f"viseme_{v}" for v in VISEME_NAMES)]
    primitives = document["meshes"][0]["primitives"]
    materials = [document["materials"][p["material"]]["name"] for p in primitives]
    assert materials == [
        "head", "teeth", "saliva", "eyeLeft", "eyeRight",
        "eyeshell", "eyelashes", "eyeEdge", "cartilage",
    ]  # fmt: skip
    for primitive, index in zip(primitives, ada_rig.dna.lod_meshes[0], strict=True):
        assert len(primitive["targets"]) == len(names)
        count = document["accessors"][primitive["attributes"]["POSITION"]]["count"]
        assert count == ada_rig.dna.mesh(index).layout_count
    mh = document["scenes"][0]["extras"]["mh"]
    assert {
        "kind",
        "preset",
        "gender",
        "lod",
        "dna_position_index",
        "neck_seam",
        "animated_maps",
    } <= set(mh)
    assert (mh["kind"], mh["preset"], mh["lod"]) == ("head", "Ada", 0)
    regions = mh["wrinkle_masks"]["regions"]
    assert regions["head_wm1_blink_L"] == [0, 0] and regions["head_wm1_jawOpen"] == [2, 0]
    maps = {name for maps in mh["animated_maps"].values() for name in maps}
    assert {name.split(".", 1)[1] for name in maps} <= set(regions)
    assert set(mh["animated_maps"]) <= set(names) and "jawOpen" in mh["animated_maps"]
    seam = mh["neck_seam"]
    assert len(seam["vertices"]) == len(seam["weights"]) > 0
    assert len(seam["positions"]) == len(seam["position_weights"]) >= len(seam["boundary"])
    assert len(document["skins"][0]["joints"]) == 870


def test_head_glb_geometry_is_consistent(ada_head_glb):
    _, document, binary = ada_head_glb
    head = document["meshes"][0]["primitives"][0]
    positions = accessor_values(document, binary, head["attributes"]["POSITION"])
    normals = accessor_values(document, binary, head["attributes"]["NORMAL"])
    indices = accessor_array(document, binary, head["indices"]).reshape(-1, 3)
    corners = positions[indices]
    face = np.cross(corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0])
    agree = np.mean(np.einsum("ij,ij->i", face, normals[indices].sum(axis=1)) > 0)
    assert agree > 0.99, f"only {agree:.1%} of triangles wind around their normals"
    assert 1.3 < positions[:, 1].min() < positions[:, 1].max() < 2.0, "head height in metres"
    assert positions[np.argmax(positions[:, 2]), 1] > 1.5, "the nose points to +Z"
    seam = document["scenes"][0]["extras"]["mh"]["neck_seam"]
    assert max(seam["vertices"]) < len(positions)
    assert all(0.0 < w <= 1.0 for w in seam["weights"])
    joints = accessor_array(document, binary, head["attributes"]["JOINTS_0"])
    weights = accessor_values(document, binary, head["attributes"]["WEIGHTS_0"])
    np.testing.assert_allclose(weights.sum(axis=1), 1.0, atol=1e-6)
    live = set(document["scenes"][0]["extras"]["mh"]["skin"]["live_joints"])
    names = [document["nodes"][i]["name"] for i in document["skins"][0]["joints"]]
    used = {names[j] for j in np.unique(joints[weights > 0])}
    assert used <= live and "head" in used


@pytest.fixture(scope="session")
def female_body_glb(bindings, archive, tmp_path_factory):
    if not (archive / "raw" / "bodies" / "female" / "done.json").is_file():
        pytest.skip("no finished female body basis export")
    web = tmp_path_factory.mktemp("web")
    stats, entry = convert_body("female", archive, web_root=web)
    assert entry["glb"] == "bodies/female/body.glb" and len(entry["sliders"]) == 7
    return stats, *read_glb(stats.path.read_bytes())


def test_body_glb_has_slider_targets_and_joint_offsets(female_body_glb):
    _, document, binary = female_body_glb
    names = document["meshes"][0]["extras"]["targetNames"]
    sliders = ("height", "weight", "muscle", "chest", "waist", "hips", "shoulders")
    assert names == [f"body_{s}_{end}" for s in sliders for end in ("min", "max")]
    mh = document["scenes"][0]["extras"]["mh"]
    assert mh["kind"] == "body" and set(mh["body_joint_deltas"]) == set(names)
    assert "head" in mh["body_joint_deltas"]["body_height_max"], "a taller body lifts the head"
    assert mh["body_joint_deltas"]["body_height_max"]["head"][1] > 0
    body = document["meshes"][0]["primitives"][0]
    positions = accessor_values(document, binary, body["attributes"]["POSITION"])
    assert abs(positions[:, 1].min()) < 0.01, "feet stand at y = 0"
    uvs = accessor_values(document, binary, body["attributes"]["TEXCOORD_0"])
    assert uvs.min() >= 0.0 and uvs.max() <= 1.0, "the body UDIM 1002 tile moves to 0..1"
    assert mh["uv_tile_offset"] == {"body": [-1, 0]}
    assert len(document["skins"][0]["joints"]) == 342


@pytest.mark.parametrize("name", ["jawOpen", "eyeBlinkLeft", "viseme_PP", "viseme_U"])
def test_head_glb_morphs_equal_the_bake(ada_head_glb, ada_rig, ada_targets, name):
    _, document, binary = ada_head_glb
    names = document["meshes"][0]["extras"]["targetNames"]
    primitives = document["meshes"][0]["primitives"]
    for primitive, index in zip(primitives, ada_rig.dna.lod_meshes[0], strict=True):
        stored = accessor_values(
            document, binary, primitive["targets"][names.index(name)]["POSITION"]
        )
        morph = ada_targets[name].meshes.get(index)
        expected = np.zeros_like(stored)
        if morph is not None:
            expected = morph.positions[ada_rig.dna.mesh(index).layout_positions] * 0.01
        # Deltas under 0.01 mm are dropped; the rest are 16-bit (0.03 mm steps).
        np.testing.assert_allclose(stored, expected, atol=1.1e-5 + 0.5 / 32767)


@pytest.mark.skipif(
    shutil.which("node") is None or not (WEB / "node_modules" / "three").is_dir(),
    reason="node or the web app's three.js is not installed",
)
def test_three_loads_the_compressed_head_glb(ada_head_glb):
    stats, _, _ = ada_head_glb
    result = subprocess.run(
        ["node", str(PIPELINE / "scripts" / "check_glb_three.mjs"), str(WEB), str(stats.path)],
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    report = json.loads(result.stdout.strip().splitlines()[-1])
    materials = [mesh["material"] for mesh in report["meshes"]]
    assert materials == [
        "head", "teeth", "saliva", "eyeLeft", "eyeRight",
        "eyeshell", "eyelashes", "eyeEdge", "cartilage",
    ]  # fmt: skip
    for mesh in report["meshes"]:
        assert mesh["skinned"] and mesh["morphs"] == 67 and "_dna_position" in mesh["attributes"]
        assert mesh["worstNormalLength"] < 1e-3 and mesh["worstWeightSum"] < 1e-4
    assert report["bones"] == 870
