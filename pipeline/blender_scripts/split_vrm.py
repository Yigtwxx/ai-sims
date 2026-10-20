"""Split a VRoid VRM into per-category part VRMs (runs inside Blender).

Usage:
    BLENDER_VRM_AUTOMATIC_LICENSE_CONFIRMATION=true \\
    blender -b --python split_vrm.py -- --input model.vrm --out-dir parts/

VRoid merges everything into a few meshes with one material per piece
(skin, tops, bottoms, shoes, hair...). Each mesh is separated by material,
each piece is classified from its material name, and every category is
exported with the full armature, so the part keeps its spring bones and
colliders. A "base" part (face + skin body, with expressions) is exported
too, so every source model can also serve as a selectable face/body. A JSON
report lists the exported files.
"""

import argparse
import json
import re
import sys
from pathlib import Path

import bpy

# Keep in sync with web/src/features/avatar/vrm/partCategories.ts.
RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"_HAIR(_\d+)?\b|HairBack", re.IGNORECASE), "hair"),
    (re.compile(r"_(Tops|Onepiece)_", re.IGNORECASE), "top"),
    (re.compile(r"_Bottoms_", re.IGNORECASE), "bottom"),
    (re.compile(r"_Shoes_", re.IGNORECASE), "shoes"),
    (re.compile(r"_Accessory_", re.IGNORECASE), "accessory"),
    (re.compile(r"_(FACE|EYE)\b|_Face_\d+_SKIN", re.IGNORECASE), "face"),
    (re.compile(r"_Body_\d+_SKIN", re.IGNORECASE), "body"),
]
PART_CATEGORIES = ("hair", "top", "bottom", "shoes")
# The base keeps the face (expressions, lip-sync morphs) and the skin body.
BASE_ROLES = ("face", "body")


def classify(material_name: str) -> str:
    for pattern, role in RULES:
        if pattern.search(material_name):
            return role
    return "other"


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(prog="split_vrm")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    return parser.parse_args(argv)


def log(message: str) -> None:
    print(f"[split_vrm] {message}", flush=True)


def clear_scene() -> None:
    # Not read_factory_settings(): that would also disable the VRM extension.
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def import_vrm(path: Path) -> bpy.types.Object:
    result = bpy.ops.import_scene.vrm(
        filepath=str(path),
        set_shading_type_to_material_on_import=False,
        set_view_transform_to_standard_on_import=False,
        set_armature_display_to_wire=False,
        set_armature_display_to_show_in_front=False,
        enable_mtoon_outline_preview=False,
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"VRM import failed for {path}: {result}")
    armatures = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
    if len(armatures) != 1:
        raise RuntimeError(f"Expected one armature in {path}, found {len(armatures)}")
    return armatures[0]


def strip_thumbnail(armature: bpy.types.Object) -> None:
    """Drop the VRM meta thumbnail; it would be duplicated into every part (~2 MB each)."""
    ext = armature.data.vrm_addon_extension
    if getattr(ext.vrm1.meta, "thumbnail_image", None) is not None:
        ext.vrm1.meta.thumbnail_image = None
        log("removed VRM 1.0 thumbnail")
    if getattr(ext.vrm0.meta, "texture", None) is not None:
        ext.vrm0.meta.texture = None
        log("removed VRM 0.x thumbnail")


def separate_by_material(armature: bpy.types.Object) -> None:
    meshes = [o for o in armature.children_recursive if o.type == "MESH"]
    for mesh in meshes:
        if len(mesh.data.materials) < 2:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        mesh.select_set(True)
        bpy.context.view_layer.objects.active = mesh
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.separate(type="MATERIAL")
        bpy.ops.object.mode_set(mode="OBJECT")


def mesh_role(mesh: bpy.types.Object) -> str:
    # After separation every piece uses one material; drop empty slots.
    names = [m.name for m in mesh.data.materials if m is not None]
    used = {mesh.data.materials[p.material_index].name for p in mesh.data.polygons}
    roles = {classify(name) for name in (used or names)}
    return roles.pop() if len(roles) == 1 else "other"


def export_part(armature: bpy.types.Object, meshes: list[bpy.types.Object], out: Path) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    for mesh in meshes:
        mesh.select_set(True)
    bpy.context.view_layer.objects.active = armature
    out.parent.mkdir(parents=True, exist_ok=True)
    result = bpy.ops.export_scene.vrm(
        filepath=str(out),
        check_existing=False,
        export_only_selections=True,
        export_invisibles=False,
        export_try_sparse_sk=True,
        armature_object_name=armature.name,
        ignore_warning=True,
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"VRM export failed for {out}: {result}")


def main() -> None:
    args = parse_args()
    clear_scene()
    armature = import_vrm(args.input)
    strip_thumbnail(armature)
    separate_by_material(armature)

    by_role: dict[str, list[bpy.types.Object]] = {}
    for mesh in (o for o in armature.children_recursive if o.type == "MESH"):
        by_role.setdefault(mesh_role(mesh), []).append(mesh)
    log(f"{args.input.name}: " + ", ".join(f"{r}={len(m)}" for r, m in sorted(by_role.items())))

    report: dict[str, object] = {"source": args.input.name, "parts": []}
    stem = args.input.stem
    groups = {"base": [m for r in BASE_ROLES for m in by_role.get(r, [])]}
    groups.update({c: by_role.get(c, []) for c in PART_CATEGORIES})
    for category, meshes in groups.items():
        if not meshes:
            continue
        out = args.out_dir / f"{stem}__{category}.vrm"
        export_part(armature, meshes, out)
        materials = sorted({m.data.materials[0].name for m in meshes if m.data.materials})
        report["parts"].append(  # type: ignore[union-attr]
            {
                "category": category,
                "file": out.name,
                "bytes": out.stat().st_size,
                "materials": materials,
            }
        )
        log(f"exported {out.name} ({out.stat().st_size / 1e6:.1f} MB)")

    (args.out_dir / f"{stem}.parts.json").write_text(json.dumps(report, indent=2))


main()
