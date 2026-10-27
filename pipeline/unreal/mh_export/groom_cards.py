"""Give the Fab grooms that ship without usable hair cards a set of card LODs and an atlas.

Two sources (`card_plans.py`):

Generated (`PLANS`), with Unreal's Hair Card Generator
(Engine/Plugins/Experimental/HairCardGenerator) and without its dialog. The plugin's own
entry point (`GenerateHairCardsForLOD`) always opens a settings dialog; its Dataflow nodes
do not. For every planned style this job builds a Dataflow graph next to the groom

    GetGroomAsset -> GroomAssetToCollection (strands) -> BuildCardsSettings
      -> GenerateCardsClumps -> GenerateCardsGeometry -> GenerateCardsTextures
      -> CardsAssetTerminal

and evaluates it once per LOD, twice: `EvaluateDataflow` runs the generator (clumps, card
geometry, texture clustering, atlas rendering into Intermediate/GroomHairCardGen), then
`EvaluateTerminalNodeByName` builds the card static mesh and imports the atlas slots
(`<base>_LOD0_TS<slot>`, the plugin's texture layout 0). The terminal node alone does not
pull the generation: Unreal calls its `Evaluate(Context)`, which the plugin leaves
unimplemented (a handled ensure in the log). The first run in a project installs the
plugin's Python packages (torch with CUDA, ~2.5 GB) through pip, from PyPI.

Hand-made (`HANDMADE`): the artist's FBX card LODs and atlas from `<archive>/fab_extras/`
are imported as `<style>_CardsMesh_LOD<n>` and `<style>_CardsAtlas_Attribute|Tangent`.

Either way the groom's card LODs point at the result, and everything lands in
`/Game/Fab/<package>/HairCards/`, where the grooms job (`grooms.py`) exports it with the rest
of the package. Args: only (style names), force (redo styles whose LOD meshes exist).
"""

from __future__ import annotations

import shutil
import time
from pathlib import Path
from typing import Any

import unreal

from mh_export import grooms, inventory
from mh_export.archive import Archive
from mh_export.card_plans import (
    CARDS_FOLDER,
    HANDMADE,
    PLANS,
    CardPlan,
    HandmadeCards,
    generation_settings_text,
)
from mh_export.card_plans import intermediate_entries as plan_entries

NODES = (
    ("get", "FGetGroomAssetDataflowNode_v2"),
    ("collection", "FGroomAssetToCollectionDataflowNode"),
    ("settings", "FBuildCardsSettingsNode"),
    ("clumps", "FGenerateCardsClumpsNode"),
    ("geometry", "FGenerateCardsGeometryNode"),
    ("textures", "FGenerateCardsTexturesNode"),
    ("terminal", "FCardsAssetTerminalNode"),
)
LINKS = (
    ("get", "GroomAsset", "collection", "GroomAsset"),
    ("collection", "Collection", "settings", "Collection"),
    ("settings", "Collection", "clumps", "Collection"),
    ("settings", "CardsSettings", "clumps", "CardsSettings"),
    ("clumps", "Collection", "geometry", "Collection"),
    ("clumps", "CardsSettings", "geometry", "CardsSettings"),
    ("geometry", "Collection", "textures", "Collection"),
    ("geometry", "CardsSettings", "textures", "CardsSettings"),
    ("textures", "Collection", "terminal", "Collection"),
    ("textures", "CardsSettings", "terminal", "CardsSettings"),
)
INTERMEDIATE_DIRS = ("Metadata", "Metadata/_generated", "Output", "Card", "CachedGrooms")


def intermediate_root() -> Path:
    """The generator's work folder (`UHairCardGeneratorPluginSettings::GetIntermediatePath`)."""
    return Path(unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_intermediate_dir()))


def clear_intermediates(plan: CardPlan) -> list[str]:
    """Drop the plan's earlier generator state. A leftover settings record makes the
    generator skip a run as up to date, and stale reduction metadata would leak into LOD1+."""
    removed = []
    root = intermediate_root() / "GroomHairCardGen"
    for sub in INTERMEDIATE_DIRS:
        folder = root / sub
        if not folder.is_dir():
            continue
        for name in plan_entries([p.name for p in folder.iterdir()], plan.base_name()):
            path = folder / name
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink()
            removed.append(f"{sub}/{name}")
    return removed


def find_groom(folder: str) -> unreal.GroomAsset:
    found = [a for a in inventory.assets_under(folder) if inventory.class_name(a) == "GroomAsset"]
    if len(found) != 1:
        raise RuntimeError(f"{folder}: expected one GroomAsset, found {len(found)}")
    groom = found[0].get_asset()
    if groom is None:
        raise RuntimeError(f"{folder}: cannot load {inventory.object_path(found[0])}")
    return groom


def set_strand_width(groom: unreal.GroomAsset, width_cm: float) -> None:
    """Override every group's strand width; the generator renders the atlas coverage with
    it. Struct properties come back as copies, so each is written back."""
    updated = []
    for group in groom.get_editor_property("hair_groups_rendering"):
        geometry = group.get_editor_property("geometry_settings")
        geometry.set_editor_property("hair_width_override", True)
        geometry.set_editor_property("hair_width", float(width_cm))
        group.set_editor_property("geometry_settings", geometry)
        updated.append(group)
    groom.set_editor_property("hair_groups_rendering", updated)


def delete_generated(cards_folder: str) -> None:
    """Delete earlier card meshes and atlases, keeping the generation graph: Unreal reports a
    deleted Dataflow asset as gone but keeps its package in a fresh editor, so creating it
    again fails ("already exists"); `build_dataflow` reuses it instead."""
    library = unreal.EditorAssetLibrary
    for asset in inventory.assets_under(cards_folder):
        if inventory.class_name(asset) != "Dataflow":
            library.delete_asset(str(asset.package_name))


def _has_node(dataflow: unreal.Dataflow, name: str) -> bool:
    """Every Dataflow node has `bActive`; setting it succeeds only on an existing node."""
    return bool(
        unreal.DataflowEditorBlueprintLibrary.set_dataflow_node_property(
            dataflow, name, "bActive", "True"
        )
    )


def build_dataflow(
    groom: unreal.GroomAsset, plan: CardPlan, cards_folder: str
) -> tuple[unreal.Dataflow, dict[str, str]]:
    """The style's generation graph: the saved one when it holds the expected nodes (node
    names are the keys of `NODES`), else a new one."""
    name = f"DF_{plan.style}_Cards"
    library = unreal.DataflowEditorBlueprintLibrary
    nodes = {key: key for key, _ in NODES}
    dataflow = unreal.load_asset(f"{cards_folder}/{name}")
    if dataflow is not None and not all(_has_node(dataflow, key) for key in nodes):
        raise RuntimeError(f"{cards_folder}/{name} lacks the generation nodes; delete it")
    if dataflow is None:
        tools = unreal.AssetToolsHelpers.get_asset_tools()
        dataflow = tools.create_asset(
            name, cards_folder, unreal.Dataflow, unreal.DataflowAssetFactory()
        )
        if dataflow is None:
            raise RuntimeError(f"Cannot create {cards_folder}/{name}")
        for index, (key, node_type) in enumerate(NODES):
            node = str(
                library.add_dataflow_node(
                    dataflow, node_type, key, unreal.Vector2D(320.0 * index, 0.0)
                )
            )
            if node != key:
                raise RuntimeError(f"Dataflow node {node_type} came out as {node!r}, not {key}")
        for source, output, target, input_ in LINKS:
            if not library.connect_dataflow_nodes(dataflow, source, output, target, input_):
                raise RuntimeError(f"Cannot connect {source}.{output} -> {target}.{input_}")
    groom_path = groom.get_path_name()
    properties = (
        ("get", "GroomAsset", groom_path),
        ("collection", "CurvesType", "Strands"),  # the node defaults to guides
        ("settings", "GroomAsset", groom_path),
        ("settings", "AssetsDirectoryPath", cards_folder),
        ("settings", "AssetsBaseName", plan.base_name()),
    )
    for key, prop, value in properties:
        if not library.set_dataflow_node_property(dataflow, nodes[key], prop, value):
            raise RuntimeError(f"Cannot set {key}.{prop} on {name}")
    return dataflow, nodes


def card_meshes(cards_folder: str) -> dict[str, unreal.StaticMesh]:
    return {
        str(asset.asset_name): asset.get_asset()
        for asset in inventory.assets_under(cards_folder)
        if inventory.class_name(asset) == "StaticMesh"
    }


def mesh_stats(mesh: unreal.StaticMesh) -> dict[str, int]:
    return {
        "vertices": int(mesh.get_num_vertices(0)),
        "triangles": int(mesh.get_num_triangles(0)),
    }


def has_mesh(meshes: dict[str, unreal.StaticMesh], lod_name: str) -> bool:
    """Generated meshes are `<base>_LOD<n>`, or `<base>_LOD<n>_PG<g>` for multi-group grooms."""
    return any(name == lod_name or name.startswith(f"{lod_name}_PG") for name in meshes)


def assign_card_lods(groom: unreal.GroomAsset, plan: CardPlan, cards_folder: str) -> None:
    """Point every generated LOD's card description at its mesh and the shared atlas.

    With one LOD per evaluation the terminal node pairs that LOD's settings with the first
    card description, so after the passes LOD0's description holds the last LOD's mesh;
    the atlas slots it holds are the same for every LOD."""
    meshes = card_meshes(cards_folder)
    cards = list(groom.get_editor_property("hair_groups_cards"))
    atlas = next(
        (
            card.get_editor_property("textures")
            for card in cards
            if any(card.get_editor_property("textures").get_editor_property("textures"))
        ),
        None,
    )
    if atlas is None:
        raise RuntimeError(f"{plan.style}: the generator assigned no atlas to the groom")
    by_lod = {lod.lod: name for lod, name in zip(plan.lods, plan.lod_names(), strict=True)}
    for card in cards:
        name = by_lod.get(int(card.get_editor_property("lod_index")))
        if name is None:
            continue
        mesh = meshes.get(name) or next(
            (m for n, m in sorted(meshes.items()) if n.startswith(f"{name}_PG")), None
        )
        card.set_editor_property("imported_mesh", mesh)
        card.set_editor_property("textures", atlas)
    groom.set_editor_property("hair_groups_cards", cards)


def generate(folder: str, plan: CardPlan) -> dict[str, Any]:
    started = time.monotonic()
    groom = find_groom(folder)
    cards_folder = f"{folder}/{CARDS_FOLDER}"
    if plan.width_cm is not None:
        set_strand_width(groom, plan.width_cm)
    cleared = clear_intermediates(plan)
    delete_generated(cards_folder)
    dataflow, nodes = build_dataflow(groom, plan, cards_folder)
    editor = unreal.DataflowEditorBlueprintLibrary
    library = unreal.DataflowBlueprintLibrary
    timings: dict[str, float] = {}
    for lod in plan.lods:
        lod_started = time.monotonic()
        text = generation_settings_text(plan, lod.lod)
        if not editor.set_dataflow_node_property(
            dataflow, nodes["settings"], "GenerationSettings", text
        ):
            raise RuntimeError(f"{plan.style}: cannot set the LOD{lod.lod} settings")
        # The first call runs the generator (it returns True when a node logged an error);
        # the second builds the LOD's mesh and imports the atlas.
        if library.evaluate_dataflow(dataflow, groom):
            raise RuntimeError(f"{plan.style}: LOD{lod.lod} generation reported errors (log)")
        library.evaluate_terminal_node_by_name(dataflow, nodes["terminal"], groom)
        if not has_mesh(card_meshes(cards_folder), plan.lod_names()[lod.lod]):
            raise RuntimeError(
                f"{plan.style}: no LOD{lod.lod} card mesh (see LogHairCardGenerator in the log)"
            )
        timings[f"LOD{lod.lod}"] = round(time.monotonic() - lod_started, 1)
    assign_card_lods(groom, plan, cards_folder)
    unreal.EditorAssetLibrary.save_directory(cards_folder, only_if_is_dirty=False, recursive=True)
    unreal.EditorAssetLibrary.save_loaded_asset(groom, only_if_is_dirty=False)
    meshes = card_meshes(cards_folder)
    return {
        "groom": groom.get_path_name(),
        "cleared": len(cleared),
        "seconds": timings,
        "total_s": round(time.monotonic() - started, 1),
        "meshes": {name: mesh_stats(mesh) for name, mesh in sorted(meshes.items())},
    }


def _import_task(source: Path, folder: str, name: str, options: object | None) -> unreal.Object:
    task = unreal.AssetImportTask()
    task.filename = str(source)
    task.destination_path = folder
    task.destination_name = name
    task.automated = True
    task.replace_existing = True
    task.save = False
    if options is not None:
        task.options = options
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    asset = unreal.load_asset(f"{folder}/{name}")
    if asset is None:
        raise RuntimeError(f"Import of {source} made no {folder}/{name}")
    return asset


def _card_mesh_options() -> unreal.FbxImportUI:
    """A static mesh with the artist's normals and tangents, no materials or textures.
    Unreal bakes the FBX node transforms and converts its axes and centimetres, which puts
    the cards on the package's groom head (as Blender's import does)."""
    options = unreal.FbxImportUI()
    options.import_mesh = True
    options.import_as_skeletal = False
    options.import_materials = False
    options.import_textures = False
    options.import_animations = False
    options.mesh_type_to_import = unreal.FBXImportType.FBXIT_STATIC_MESH
    data = options.static_mesh_import_data
    data.combine_meshes = True
    data.generate_lightmap_u_vs = False
    data.auto_generate_collision = False
    data.normal_import_method = unreal.FBXNormalImportMethod.FBXNIM_IMPORT_NORMALS_AND_TANGENTS
    return options


def import_handmade(folder: str, cards: HandmadeCards, extras_root: Path) -> dict[str, Any]:
    started = time.monotonic()
    source = extras_root / cards.extras
    if not source.is_dir():
        raise RuntimeError(f"{cards.style}: no {source} (unzip the Fab listing's extras there)")
    groom = find_groom(folder)
    cards_folder = f"{folder}/{CARDS_FOLDER}"
    delete_generated(cards_folder)
    meshes = [
        _import_task(source / path, cards_folder, cards.mesh_name(lod), _card_mesh_options())
        for lod, path in enumerate(cards.lods)
    ]
    atlas: dict[str, unreal.Texture2D] = {}
    for role, path in (("attribute", cards.attribute), ("tangent", cards.tangent)):
        texture = _import_task(source / path, cards_folder, cards.texture_name(role), None)
        texture.set_editor_property("srgb", False)  # data maps, as Epic's atlases are
        atlas[role] = texture
    updated = []
    for card in groom.get_editor_property("hair_groups_cards"):
        lod = int(card.get_editor_property("lod_index"))
        if 0 <= lod < len(meshes):
            card.set_editor_property("imported_mesh", meshes[lod])
            textures = card.get_editor_property("textures")
            # Epic's card layout (Hair_L_HighPonytail): tangent, attribute, no material map.
            textures.set_editor_property("layout", unreal.HairTextureLayout.LAYOUT2)
            textures.set_editor_property("textures", [atlas["tangent"], atlas["attribute"], None])
            card.set_editor_property("textures", textures)
        updated.append(card)
    groom.set_editor_property("hair_groups_cards", updated)
    unreal.EditorAssetLibrary.save_directory(cards_folder, only_if_is_dirty=False, recursive=True)
    unreal.EditorAssetLibrary.save_loaded_asset(groom, only_if_is_dirty=False)
    return {
        "groom": groom.get_path_name(),
        "total_s": round(time.monotonic() - started, 1),
        "meshes": {mesh.get_name(): mesh_stats(mesh) for mesh in meshes},
    }


def run(archive: Archive, args: dict[str, Any]) -> dict[str, Any]:
    """Args: only (style names), force (redo styles whose LOD meshes exist)."""
    only = set(args.get("only") or [])
    force = bool(args.get("force"))
    results: dict[str, Any] = {}
    errors: dict[str, str] = {}
    for _slot, folder, style in grooms.fab_styles():
        if only and style not in only:
            continue
        plan, handmade = PLANS.get(style), HANDMADE.get(style)
        if plan is not None:
            names = plan.lod_names()
        elif handmade is not None:
            names = [handmade.mesh_name(lod) for lod in range(len(handmade.lods))]
        else:
            continue
        existing = card_meshes(f"{folder}/{CARDS_FOLDER}")
        if not force and all(has_mesh(existing, name) for name in names):
            results[style] = "exists"
            continue
        try:
            if plan is not None:
                results[style] = generate(folder, plan)
            elif handmade is not None:
                results[style] = import_handmade(folder, handmade, archive.root / "fab_extras")
        except Exception as exc:  # one style failing should not stop the others
            errors[style] = f"{type(exc).__name__}: {exc}"
            unreal.log_error(f"[groom_cards] {style}: {errors[style]}")
    unknown = sorted(only - set(PLANS) - set(HANDMADE))
    if errors or unknown:
        raise RuntimeError(f"failed: {errors}; no plan for: {unknown}; done: {sorted(results)}")
    return {"styles": results}
