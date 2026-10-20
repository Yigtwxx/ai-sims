"""Build a base human with MPFB and export it as GLB (runs inside Blender).

Usage:
    blender -b --python build_base.py -- --gender male --out /path/base_male.glb

The output contains one armature (plain humanoid bone names with eye and
jaw bones) and skinned meshes for body, eyes, brows, lashes, teeth, tongue,
hair and a spike outfit (clothes + shoes). Body and face parts carry ARKit
(52) and Meta/Oculus viseme (15) shape keys for lip-sync. A JSON report is
written next to the GLB.
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import bpy
from bl_ext.blender_org.mpfb.services import (  # type: ignore[import-not-found]
    AssetService,
    ExportService,
    FaceService,
    HumanService,
    TargetService,
)

RIG = "mixamo_unity"

# MakeHuman macro values are 0..1; age 0.5 is ~25 years.
MACROS: dict[str, dict[str, Any]] = {
    "male": {
        "gender": 1.0,
        "age": 0.5,
        "muscle": 0.62,
        "weight": 0.52,
        "height": 0.6,
        "proportions": 0.65,
        "race": {"african": 0.0, "asian": 0.0, "caucasian": 1.0},
    },
    "female": {
        "gender": 0.0,
        "age": 0.5,
        "muscle": 0.5,
        "weight": 0.48,
        "height": 0.5,
        "proportions": 0.7,
        "cupsize": 0.5,
        "firmness": 0.55,
        "race": {"african": 0.0, "asian": 0.0, "caucasian": 1.0},
    },
}

# (asset_type, path fragment) resolved via AssetService.find_asset_absolute_path.
BODY_PARTS: dict[str, list[tuple[str, str]]] = {
    "male": [
        ("eyes", "high-poly/high-poly.mhclo"),
        ("eyebrows", "eyebrow001/eyebrow001.mhclo"),
        ("eyelashes", "eyelashes01/eyelashes01.mhclo"),
        ("teeth", "teeth_base/teeth_base.mhclo"),
        ("tongue", "tongue01/tongue01.mhclo"),
        ("hair", "short02/short02.mhclo"),
        ("clothes", "male_casualsuit06/male_casualsuit06.mhclo"),
        ("clothes", "shoes06/shoes06.mhclo"),
    ],
    "female": [
        ("eyes", "high-poly/high-poly.mhclo"),
        ("eyebrows", "eyebrow010/eyebrow010.mhclo"),
        ("eyelashes", "eyelashes02/eyelashes02.mhclo"),
        ("teeth", "teeth_base/teeth_base.mhclo"),
        ("tongue", "tongue01/tongue01.mhclo"),
        ("hair", "bob02/bob02.mhclo"),
        ("clothes", "female_casualsuit01/female_casualsuit01.mhclo"),
        ("clothes", "shoes05/shoes05.mhclo"),
    ],
}

SKINS: dict[str, str] = {
    "male": "young_caucasian_male/young_caucasian_male.mhmat",
    "female": "young_caucasian_female/young_caucasian_female.mhmat",
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(prog="build_base")
    parser.add_argument("--gender", choices=sorted(MACROS), required=True)
    parser.add_argument("--out", type=Path, required=True)
    return parser.parse_args(argv)


def log(message: str) -> None:
    print(f"[build_base] {message}", flush=True)


def clear_scene() -> None:
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh)


def resolve_asset(fragment: str, subdir: str) -> str:
    path = AssetService.find_asset_absolute_path(fragment, subdir)
    if not path:
        available = AssetService.list_mhclo_assets(subdir) if subdir != "skins" else []
        raise FileNotFoundError(f"Asset '{fragment}' not found in '{subdir}'. Have: {available}")
    return str(path)


def build_human(gender: str) -> bpy.types.Object:
    macros = TargetService.get_default_macro_info_dict()
    for key, value in MACROS[gender].items():
        macros[key] = value
    basemesh = HumanService.create_human(scale=0.1, macro_detail_dict=macros)
    log(f"created basemesh '{basemesh.name}' ({len(basemesh.data.vertices)} verts)")

    # Rig must exist before assets so they get weights and an armature modifier.
    HumanService.add_builtin_rig(basemesh, RIG, import_weights=True)

    for asset_type, fragment in BODY_PARTS[gender]:
        path = resolve_asset(fragment, asset_type)
        HumanService.add_mhclo_asset(
            path,
            basemesh,
            asset_type=asset_type,
            subdiv_levels=0,
            material_type="GAMEENGINE",
            import_subrig=False,
        )
        log(f"added {asset_type}: {fragment}")

    skin = resolve_asset(SKINS[gender], "skins")
    HumanService.set_character_skin(
        skin, basemesh, skin_type="GAMEENGINE", material_instances=False
    )
    log(f"skin: {SKINS[gender]}")
    return basemesh


def add_face_shape_keys(basemesh: bpy.types.Object) -> None:
    # Freeze the body shape so the only remaining shape keys are facial ones.
    TargetService.bake_targets(basemesh)
    FaceService.load_targets(
        basemesh,
        load_microsoft_visemes=False,
        load_meta_visemes=True,
        load_arkit_faceunits=True,
    )
    FaceService.interpolate_targets(basemesh)
    ExportService.bake_modifiers_remove_helpers(
        basemesh, bake_masks=True, bake_subdiv=False, remove_helpers=True, also_proxy=True
    )


def strip_bone_prefix(armature: bpy.types.Object, prefix: str = "mixamorig:") -> None:
    """Use plain humanoid bone names (Hips, Head, LeftEye...) like most web avatar tooling."""
    for bone in armature.data.bones:
        if bone.name.startswith(prefix):
            bone.name = bone.name[len(prefix) :]


def strip_non_armature_modifiers(root: bpy.types.Object) -> None:
    """glTF drops shape keys on meshes with unapplied modifiers; keep only skinning."""
    for obj in [root, *root.children_recursive]:
        if obj.type != "MESH":
            continue
        for modifier in list(obj.modifiers):
            if modifier.type != "ARMATURE":
                obj.modifiers.remove(modifier)


def select_hierarchy(armature: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in [armature, *armature.children_recursive]:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = armature


def export_glb(armature: bpy.types.Object, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    select_hierarchy(armature)
    bpy.ops.export_scene.gltf(
        filepath=str(out),
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_skins=True,
        export_morph=True,
        export_morph_normal=True,
        export_animations=False,
        export_yup=True,
        export_image_format="AUTO",
    )


def write_report(armature: bpy.types.Object, out: Path) -> None:
    meshes = [o for o in armature.children_recursive if o.type == "MESH"]
    report = {
        "rig": RIG,
        "bones": [b.name for b in armature.data.bones],
        "meshes": {
            m.name: {
                "vertices": len(m.data.vertices),
                "materials": [s.material.name for s in m.material_slots if s.material],
                "shape_keys": (
                    [k.name for k in m.data.shape_keys.key_blocks] if m.data.shape_keys else []
                ),
            }
            for m in meshes
        },
    }
    out.with_suffix(".report.json").write_text(json.dumps(report, indent=2))


def main() -> None:
    args = parse_args()
    clear_scene()
    AssetService.update_all_asset_lists()
    FaceService.is_faceunits01_installed(force_recheck=True)

    basemesh = build_human(args.gender)
    add_face_shape_keys(basemesh)

    armature = basemesh.parent
    if armature is None or armature.type != "ARMATURE":
        raise RuntimeError("Expected the basemesh to be parented to its armature")
    strip_non_armature_modifiers(armature)
    strip_bone_prefix(armature)

    export_glb(armature, args.out)
    write_report(armature, args.out)
    log(f"exported {args.out}")


main()
