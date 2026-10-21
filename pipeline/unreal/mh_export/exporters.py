"""File exporters shared by the export jobs: meshes, textures and animations."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import unreal

from mh_export import ue

TEXTURE_EXTENSIONS = (".png", ".tga", ".exr")
CUBE_EXTENSIONS = (".hdr", ".exr", ".dds")


def fbx_options() -> unreal.FbxExportOption:
    options = unreal.FbxExportOption()
    options.ascii = False
    options.collision = False
    options.level_of_detail = False
    options.vertex_color = True
    options.export_morph_targets = True
    return options


def export_object(obj: unreal.Object, path: Path, options: object | None = None) -> bool:
    """Run the registered exporter for `path`'s extension; True when the file exists."""
    path.parent.mkdir(parents=True, exist_ok=True)
    task = unreal.AssetExportTask()
    task.object = obj
    task.filename = str(path)
    task.automated = True
    task.prompt = False
    task.replace_identical = True
    if options is not None:
        task.options = options
    return bool(unreal.Exporter.run_asset_export_task(task)) and path.is_file()


def texture_info(texture: unreal.Texture) -> dict[str, Any]:
    info: dict[str, Any] = ue.dump_properties(
        texture, ["srgb", "compression_settings", "lod_group", "filter", "address_x", "address_y"]
    )
    if isinstance(texture, unreal.Texture2D):
        info["size"] = [texture.blueprint_get_size_x(), texture.blueprint_get_size_y()]
    return info


def export_texture(
    texture: unreal.Texture, out_dir: Path, stem: str | None = None
) -> dict[str, Any]:
    """Try lossless formats in order; 16-bit and float sources may refuse PNG."""
    extensions = CUBE_EXTENSIONS if isinstance(texture, unreal.TextureCube) else TEXTURE_EXTENSIONS
    for extension in extensions:
        path = out_dir / f"{stem or texture.get_name()}{extension}"
        if export_object(texture, path):
            return {"file": path.name, **texture_info(texture)}
    raise RuntimeError(f"No exporter wrote {texture.get_path_name()}")


BAKE_SIZE = 4096  # upper bound; auto-detect follows the largest map the graph samples


def gltf_options(bake: bool = False) -> unreal.GLTFExportOptions:
    """`bake` renders every material input to textures on the mesh UVs (for materials
    whose graph the web cannot rebuild from the instance parameters alone)."""
    options = unreal.GLTFExportOptions()
    bake_mode = (
        unreal.GLTFMaterialBakeMode.USE_MESH_DATA if bake else unreal.GLTFMaterialBakeMode.DISABLED
    )
    # Keep every vertex attribute and morph target; compression happens later on our side.
    settings: dict[str, Any] = {
        "export_vertex_colors": True,
        "export_vertex_skin_weights": True,
        "export_morph_targets": True,
        "export_animation_sequences": True,
        "export_preview_mesh": True,
        "export_lights": False,
        "export_cameras": False,
        "adjust_normalmaps": True,
        "bake_material_inputs": bake_mode,
        "texture_image_format": unreal.GLTFTextureImageFormat.PNG,
    }
    if bake:
        settings["default_material_bake_size"] = unreal.GLTFMaterialBakeSize(
            x=BAKE_SIZE, y=BAKE_SIZE, auto_detect=True
        )
    for name, value in settings.items():
        try:
            options.set_editor_property(name, value)
        except Exception as exc:  # option names move between engine versions
            unreal.log_warning(f"[mh_export] glTF option {name} not set: {exc}")
    return options


def export_gltf(obj: unreal.Object, path: Path, bake: bool = False) -> bool:
    """glTF via the GLTFExporter plugin (meshes keep skin weights and morph targets)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if export_object(obj, path, gltf_options(bake)):
        return True
    exporter = getattr(unreal, "GLTFExporter", None)
    if exporter is None:
        return False
    exporter.export_to_gltf(obj, str(path), gltf_options(bake), set())
    return path.is_file()
