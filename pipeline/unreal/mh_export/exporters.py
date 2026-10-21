"""File exporters shared by the export jobs: meshes, textures and animations."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import unreal

from mh_export import udim, ue

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
    """Try lossless formats in order; 16-bit and float sources may refuse PNG.

    A UDIM texture writes one file per tile (`<stem>.1001.png`, ...) instead of the
    requested file: those are recorded under `udim` (tile -> file), and no further format
    is tried (each would write every tile again; uncompressed TGA tiles made up most of
    the 1.15 GB KhaosMDF255 export). `size` is then the whole tile grid.
    """
    extensions = CUBE_EXTENSIONS if isinstance(texture, unreal.TextureCube) else TEXTURE_EXTENSIONS
    for extension in extensions:
        path = out_dir / f"{stem or texture.get_name()}{extension}"
        if export_object(texture, path):
            return {"file": path.name, **texture_info(texture)}
        tiles = udim.tile_files(path)
        if tiles:
            return {
                "udim": {str(tile): file.name for tile, file in tiles.items()},
                **texture_info(texture),
            }
    raise RuntimeError(f"No exporter wrote {texture.get_path_name()}")


# Fixed, not auto-detected: auto-detect takes the largest map the graph samples, uncapped,
# and a UDIM texture reports its whole tile grid (KhaosMDF322: 6 x 6 tiles of 4096 px =
# 24576 px). MaterialBaking clamps its render target to 16384 px but reads it back at the
# requested size, which fails `check(SrcPitch > DstPitch)` (RHISurfaceDataConversion.h)
# on a worker thread and kills the editor. The web keeps at most 2048 px per map.
BAKE_SIZE = 4096


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
            x=BAKE_SIZE, y=BAKE_SIZE, auto_detect=False
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
