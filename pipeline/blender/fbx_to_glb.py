"""Convert FBX files to GLB in a headless Blender, transforms applied, no animation.

    blender --background --factory-startup --python fbx_to_glb.py -- <in.fbx> <out.glb> [...]

Used for meshes that come outside a Fab package (hand-made hair cards shipped as FBX next
to the .mhpkg). Every mesh's object transform is applied to its vertices, so readers that
ignore glTF node transforms (the groom converter) see the same positions as Blender.

With the transforms applied, Blender's FBX import (centimetres to metres, the file's axes
to Z up) and the glTF export (Z up to Y up) land the hand-made cards of
Hair_F_Ponytail_MessyWavy_01 on the package's groom head: its Female_Herad_Mesh.fbx comes
out on SKM_MH_Groom_Head (0.0 mm median, 2.4 mm at most). Without applying them the
vertices stay in the file's centimetres with the head lying on its back. Tangents are
written for card meshes, whose shading needs them.
"""

import sys
from pathlib import Path

import bpy


def convert(source: Path, target: Path) -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(source))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    for obj in bpy.context.scene.objects:
        obj.select_set(obj in meshes)
    if meshes:
        bpy.context.view_layer.objects.active = meshes[0]
        # Parents (FBX root nodes) carry part of the transform; bake the world matrix.
        for obj in meshes:
            world = obj.matrix_world.copy()
            obj.parent = None
            obj.matrix_world = world
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    target.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(target),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=True,
        export_materials="PLACEHOLDER",
        export_skins=False,
        export_animations=False,
    )
    print("FBX_TO_GLB", source.name, "->", target, "meshes", len(meshes))


def main() -> None:
    args = sys.argv[sys.argv.index("--") + 1 :]
    if len(args) % 2:
        raise SystemExit("expected <in.fbx> <out.glb> pairs")
    for source, target in zip(args[::2], args[1::2], strict=True):
        convert(Path(source), Path(target))


if __name__ == "__main__":
    main()
