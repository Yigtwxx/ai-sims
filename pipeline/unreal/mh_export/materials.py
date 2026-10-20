"""Dump MetaHuman materials so the web shaders can follow the same math.

Material instances: parent chain plus every scalar, vector, texture and static
switch value. Base materials and material functions: the expression graph,
walked from each material output through its inputs, with every node's
editable properties (constants, texture references, function calls).
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import unreal

from mh_export import inventory, ue
from mh_export.archive import Archive, JobLog, SkipList, Unit, run_units, write_json

ROOTS = ("/MetaHumanCharacter", "/MetaHuman")
MEL = unreal.MaterialEditingLibrary
MATERIAL_PROPERTIES = [
    name
    for name in (
        "MP_BASE_COLOR",
        "MP_METALLIC",
        "MP_SPECULAR",
        "MP_ROUGHNESS",
        "MP_ANISOTROPY",
        "MP_EMISSIVE_COLOR",
        "MP_OPACITY",
        "MP_OPACITY_MASK",
        "MP_NORMAL",
        "MP_TANGENT",
        "MP_WORLD_POSITION_OFFSET",
        "MP_SUBSURFACE_COLOR",
        "MP_CUSTOM_DATA0",
        "MP_CUSTOM_DATA1",
        "MP_AMBIENT_OCCLUSION",
        "MP_REFRACTION",
        "MP_PIXEL_DEPTH_OFFSET",
        "MP_SHADING_MODEL",
    )
    if hasattr(unreal.MaterialProperty, name)
]


def _safe(call: Callable[..., object], *args: object) -> object:
    try:
        return call(*args)
    except Exception as exc:
        return {"error": f"{type(exc).__name__}: {exc}"}


def dump_instance(mi: unreal.MaterialInstance) -> dict[str, Any]:
    chain = []
    parent = mi.get_editor_property("parent")
    while parent is not None:
        chain.append(parent.get_path_name())
        parent = (
            parent.get_editor_property("parent")
            if isinstance(parent, unreal.MaterialInstance)
            else None
        )
    scalars = {
        str(n): MEL.get_material_instance_scalar_parameter_value(mi, n)
        for n in MEL.get_scalar_parameter_names(mi)
    }
    vectors = {
        str(n): ue.to_text(MEL.get_material_instance_vector_parameter_value(mi, n))
        for n in MEL.get_vector_parameter_names(mi)
    }
    textures = {}
    for n in MEL.get_texture_parameter_names(mi):
        tex = MEL.get_material_instance_texture_parameter_value(mi, n)
        textures[str(n)] = tex.get_path_name() if tex else None
    switches = {
        str(n): MEL.get_material_instance_static_switch_parameter_value(mi, n)
        for n in MEL.get_static_switch_parameter_names(mi)
    }
    return {
        "class": mi.get_class().get_name(),
        "parents": chain,
        "scalars": scalars,
        "vectors": vectors,
        "textures": textures,
        "static_switches": switches,
    }


def _expression_record(expression: unreal.MaterialExpression) -> dict[str, Any]:
    record: dict[str, Any] = {"class": expression.get_class().get_name()}
    record.update(ue.dump_properties(expression))
    for key in (
        "material_expression_editor_x",
        "material_expression_editor_y",
        "material_expression_guid",
    ):
        record.pop(key, None)
    return record


def dump_graph(material: unreal.Object) -> dict[str, Any]:
    """Expression nodes reachable from the material outputs, keyed by object name."""
    nodes: dict[str, Any] = {}
    outputs: dict[str, Any] = {}

    def visit(expression: unreal.MaterialExpression | None) -> str | None:
        if expression is None:
            return None
        key = expression.get_name()
        if key in nodes:
            return key
        nodes[key] = _expression_record(expression)
        inputs = _safe(MEL.get_inputs_for_material_expression, material, expression)
        names = _safe(MEL.get_material_expression_input_names, expression)
        if isinstance(inputs, list):
            nodes[key]["inputs"] = {
                (str(names[i]) if isinstance(names, list) and i < len(names) else str(i)): visit(
                    child
                )
                for i, child in enumerate(inputs)
            }
        return key

    if isinstance(material, unreal.Material):
        for prop in MATERIAL_PROPERTIES:
            node = _safe(
                MEL.get_material_property_input_node,
                material,
                getattr(unreal.MaterialProperty, prop),
            )
            if isinstance(node, unreal.MaterialExpression):
                outputs[prop] = visit(node)
        info = ue.dump_properties(
            material,
            [
                "blend_mode",
                "shading_model",
                "two_sided",
                "material_domain",
                "use_material_attributes",
            ],
        )
    else:
        info = {}
    return {"info": info, "outputs": outputs, "nodes": nodes}


def export_asset(path: str, work: Path) -> dict[str, Any]:
    obj = unreal.load_asset(path)
    payload = dump_instance(obj) if isinstance(obj, unreal.MaterialInstance) else dump_graph(obj)
    payload["asset"] = path
    write_json(work / "material.json", payload)
    return {"asset": path, "class": obj.get_class().get_name()}


def run(archive: Archive, args: dict[str, Any]) -> dict[str, Any]:
    inventory.scan(ROOTS)
    classes = {"MaterialInstanceConstant", "Material", "MaterialFunction"}
    paths = inventory.find_assets(classes, ROOTS)
    units = []
    for path in paths:
        parts = path.rsplit(".", 1)[0].strip("/").split("/")
        units.append(
            Unit(
                name=f"materials/{'/'.join(parts)}",
                directory=archive.unit_dir("materials", *parts),
                export=lambda work, path=path: export_asset(path, work),
            )
        )
    log = JobLog(archive.logs, "materials")
    summary = run_units(units, log, force=bool(args.get("force")), skip=SkipList(archive.skip_file))
    return {"assets": len(units), "log": str(log.path), **summary.as_dict()}
