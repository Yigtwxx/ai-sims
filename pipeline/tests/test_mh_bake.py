"""Bake quality checks on Ada's head (ARKit 52 + visemes), in the DNA's centimetres.

Shapes are measured as exported: rest positions plus the baked deltas. Fixtures are in
`conftest.py`; everything skips without the bindings or the archived Ada export.
"""

import numpy as np
import pytest
from scipy.spatial import cKDTree

from asset_pipeline.mh.arkit import ARKIT_NAMES, MOUTH_CLOSE
from asset_pipeline.mh.bake import MorphTarget, ShapeSpec, mesh_kind, vertex_normals
from asset_pipeline.mh.qa import EyeOpening, MouthLandmarks, chin
from asset_pipeline.mh.visemes import VISEME_NAMES

HEAD = "head_lod0_mesh"
TEETH = "teeth_lod0_mesh"

# Rig-data asymmetries (left and right are authored differently; checked against the
# mirrored deformation, independent of how deltas are composed). Excluded from symmetry QA.
ASYMMETRIC_PAIRS = ("jawLeft", "mouthPressLeft", "mouthLowerDownLeft")
SYMMETRIC_PAIRS = [
    name for name in ARKIT_NAMES if name.endswith("Left") and name not in ASYMMETRIC_PAIRS
]


def posed(rig, targets: dict[str, MorphTarget], mesh: str, *names: str) -> np.ndarray:
    """Rest positions of `mesh` plus the deltas of the named targets (as the GLB adds them)."""
    index = rig.dna.mesh(mesh).index
    positions = rig.deform(index, rig.evaluate()).copy()
    for name in names:
        morph = targets[name].meshes.get(index)
        if morph is not None:
            positions += morph.positions
    return positions


def mouth(rig, targets, landmarks: MouthLandmarks, *names: str) -> dict[str, float]:
    return landmarks.measure(posed(rig, targets, HEAD, *names), posed(rig, targets, TEETH, *names))


# ---------------------------------------------------------------------------- mapping


def test_arkit_mapping_resolves_every_pose_to_dna_controls(ada_mapping):
    assert set(ada_mapping.poses) == set(ARKIT_NAMES) - {MOUTH_CLOSE}
    assert ada_mapping.poses["jawOpen"] == {"CTRL_expressions.jawOpen": 1.0}
    assert ada_mapping.poses["eyeBlinkLeft"] == {"CTRL_expressions.eyeBlinkL": 1.0}
    # The Default pose (noseWrinkleUpper* = 1) is subtracted, so nothing keeps it.
    assert all("noseWrinkleUpper" not in c for p in ada_mapping.poses.values() for c in p)
    closed = ada_mapping.controls(MOUTH_CLOSE)
    assert closed["CTRL_expressions.jawOpen"] == 1.0
    assert sum(name.startswith("CTRL_expressions.mouthLipsTogether") for name in closed) == 4
    for curve in ada_mapping.unmatched_curves:  # RBF outputs and controls this DNA lacks
        assert curve.startswith(("ctrl_expressions_head", "ctrl_expressions_tongueroll")) or (
            curve == "ctrl_expressions_skullunified"
        ), curve


# ---------------------------------------------------------------------------- invariants


def test_targets_carry_the_contract_names(ada_targets):
    expected = [*ARKIT_NAMES, *(f"viseme_{name}" for name in VISEME_NAMES)]
    assert list(ada_targets) == expected
    assert len(expected) == 67


def test_neutral_bakes_to_exactly_zero(ada_baker, ada_targets):
    rest = ada_baker.bake("rest", ShapeSpec(controls={}))
    for morph in rest.meshes.values():
        assert not morph.positions.any() and not morph.normals.any()
    assert rest.animated_maps == {}
    for morph in ada_targets["viseme_sil"].meshes.values():
        assert not morph.positions.any()


def test_eyeballs_are_left_to_their_joints(ada_rig, ada_targets):
    eyeballs = {ada_rig.dna.mesh(f"{side}_lod0_mesh").index for side in ("eyeLeft", "eyeRight")}
    for target in ada_targets.values():
        assert not eyeballs & set(target.meshes), target.name
    baked = {mesh_kind(ada_rig.dna.mesh_names[i]) for i in ada_targets["eyeBlinkLeft"].meshes}
    assert {"head", "eyelashes", "eyeshell", "eyeEdge", "cartilage"} <= baked


def test_normal_deltas_are_differences_of_unit_normals(ada_rig, ada_targets):
    mesh = ada_rig.dna.mesh(HEAD)
    triangles = mesh.layout_positions[mesh.triangles]
    jaw = posed(ada_rig, ada_targets, HEAD, "jawOpen")
    rest = posed(ada_rig, ada_targets, HEAD)
    expected = vertex_normals(jaw, triangles) - vertex_normals(rest, triangles)
    np.testing.assert_allclose(
        ada_targets["jawOpen"].meshes[mesh.index].normals, expected, atol=1e-9
    )


# ---------------------------------------------------------------------------- ARKit quality


@pytest.mark.parametrize(("blink", "other"), [("eyeBlinkLeft", "R"), ("eyeBlinkRight", "L")])
def test_eye_blink_closes_the_lid_gap(ada_rig, ada_targets, blink, other):
    side = "L" if blink.endswith("Left") else "R"
    eye = {"L": "eyeLeft_lod0_mesh", "R": "eyeRight_lod0_mesh"}
    rest = posed(ada_rig, ada_targets, HEAD)
    closed = posed(ada_rig, ada_targets, HEAD, blink)
    lid = EyeOpening.find(rest, ada_rig.dna.mesh(eye[side]).positions.astype(np.float64))
    untouched = EyeOpening.find(rest, ada_rig.dna.mesh(eye[other]).positions.astype(np.float64))
    assert 0.6 < lid.measure(rest) < 1.3, "rest opening should be 6-13 mm"
    assert lid.measure(closed) < 0.2, f"{blink} leaves {lid.measure(closed):.2f} cm open"
    assert abs(untouched.measure(closed) - untouched.measure(rest)) < 0.02


def test_jaw_open_drops_the_chin_and_the_lower_teeth_follow(ada_rig, ada_targets, ada_mouth):
    index = chin(ada_rig, HEAD)
    moved = ada_targets["jawOpen"].meshes[ada_rig.dna.mesh(HEAD).index].positions[index]
    assert -4.0 < moved[1] < -1.5, f"chin moved {moved} cm"
    assert moved[2] < 0.0, "the chin swings back around the jaw hinge"
    assert abs(moved[0]) < 0.05
    teeth = ada_targets["jawOpen"].meshes[ada_rig.dna.mesh(TEETH).index].positions
    assert np.abs(teeth[ada_mouth.incisal_edge]).max() < 0.05, "upper teeth stay still"
    assert teeth[:, 1].min() < 0.6 * moved[1], "lower teeth drop with the jaw"


def test_mouth_close_seals_lips_over_an_open_jaw(ada_rig, ada_targets, ada_mouth):
    rest = mouth(ada_rig, ada_targets, ada_mouth)
    open_jaw = mouth(ada_rig, ada_targets, ada_mouth, "jawOpen")
    sealed = mouth(ada_rig, ada_targets, ada_mouth, "jawOpen", "mouthClose")
    assert open_jaw["opening"] > 2.0
    # With the jaw fully open (3 cm) the rig's lips-together leaves the lips 1.3 mm apart on
    # average (rest: 0.7 mm) and at most ~3.5 mm at a few contact pairs.
    assert sealed["opening"] < rest["opening"] + 0.1, sealed
    assert sealed["gap_central_max"] < 0.5, sealed


@pytest.mark.parametrize("left", SYMMETRIC_PAIRS)
def test_left_and_right_shapes_mirror(ada_rig, ada_targets, left):
    """Mirrored within 12 % RMS, or within 0.5 mm at p99 for the small lid follow-through
    shapes (eyeLookIn/Out, eyeWide) where relative errors are dominated by noise."""
    right = left.removesuffix("Left") + "Right"
    index = ada_rig.dna.mesh(HEAD).index
    positions = ada_rig.dna.mesh(HEAD).positions.astype(np.float64)
    _, mirror = cKDTree(positions).query(positions * [-1, 1, 1])
    left_moved = ada_targets[left].meshes[index].positions
    right_moved = ada_targets[right].meshes[index].positions
    error = np.linalg.norm(right_moved - left_moved[mirror] * [-1, 1, 1], axis=1)
    magnitude = np.linalg.norm(right_moved, axis=1)
    moving = magnitude > 0.01
    relative = np.sqrt((error[moving] ** 2).mean() / (magnitude[moving] ** 2).mean())
    p99 = np.percentile(error, 99)
    assert relative < 0.12 or p99 < 0.05, f"{left}: {relative:.1%} RMS, p99 {p99:.3f} cm"


def test_wrinkle_maps_follow_the_shapes(ada_targets):
    assert ada_targets["eyeBlinkLeft"].animated_maps["head_cm1_color.head_wm1_blink_L"] == 1.0
    assert ada_targets["jawOpen"].animated_maps["head_wm1_normal.head_wm1_jawOpen"] == 1.0
    for target in ada_targets.values():
        assert all(-1.0 <= weight <= 1.0 for weight in target.animated_maps.values()), target.name


# ---------------------------------------------------------------------------- visemes


def test_pp_seals_the_lips(ada_rig, ada_targets, ada_mouth):
    rest = mouth(ada_rig, ada_targets, ada_mouth)
    pp = mouth(ada_rig, ada_targets, ada_mouth, "viseme_PP")
    assert pp["gap_central_max"] < rest["gap_central_max"] + 0.03, pp
    assert pp["gap_max"] < rest["gap_max"] + 0.03, pp


def test_ff_rests_the_lower_lip_on_the_upper_incisors(ada_rig, ada_targets, ada_mouth):
    ff = mouth(ada_rig, ada_targets, ada_mouth, "viseme_FF")
    assert ff["lower_lip_to_incisors"] < 0.05, ff
    assert ff["opening"] > 0.3, "the upper teeth must show"


def test_rounded_visemes_narrow_and_protrude(ada_rig, ada_targets, ada_mouth):
    o = mouth(ada_rig, ada_targets, ada_mouth, "viseme_O")
    u = mouth(ada_rig, ada_targets, ada_mouth, "viseme_U")
    assert o["width_ratio"] < 0.85 and o["protrusion"] > 0.15, o
    assert u["width_ratio"] < 0.75 and u["protrusion"] > 0.4, u
    assert u["width_ratio"] < o["width_ratio"] and u["opening"] < o["opening"]


def test_vowels_open_and_spread(ada_rig, ada_targets, ada_mouth):
    aa = mouth(ada_rig, ada_targets, ada_mouth, "viseme_aa")
    e = mouth(ada_rig, ada_targets, ada_mouth, "viseme_E")
    i = mouth(ada_rig, ada_targets, ada_mouth, "viseme_I")
    assert aa["opening"] > 1.5, aa
    assert i["width_ratio"] > 1.12 and e["width_ratio"] > 1.05
    assert i["opening"] < e["opening"] < aa["opening"]


def test_tongue_visemes_place_the_tip(ada_rig, ada_targets, ada_mouth):
    th = mouth(ada_rig, ada_targets, ada_mouth, "viseme_TH")
    dd = mouth(ada_rig, ada_targets, ada_mouth, "viseme_DD")
    nn = mouth(ada_rig, ada_targets, ada_mouth, "viseme_nn")
    kk = mouth(ada_rig, ada_targets, ada_mouth, "viseme_kk")
    assert th["tongue_tip_forward"] > 0.2 and abs(th["tongue_tip_up"]) < 0.3, th
    assert dd["tongue_tip_up"] > 0.8 and dd["tongue_tip_forward"] < 0.0, dd
    assert nn["tongue_tip_up"] > 0.6, nn
    assert kk["tongue_tip_up"] < 0.3, kk
