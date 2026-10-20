"""Dump the MetaHuman Creator lighting rigs (Studio, Portrait, ...) as data.

Each LightingEnvironments level is loaded and every light, sky light, post
process volume and background actor is written out with its transform and
settings, so the web stage can reproduce the same key/fill/rim setups.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import unreal

from mh_export import inventory, ue
from mh_export.archive import Archive, JobLog, SkipList, Unit, run_units, write_json

ROOT = "/MetaHumanCharacter/LightingEnvironments"
LIGHT_FIELDS = [
    "intensity",
    "intensity_units",
    "light_color",
    "temperature",
    "use_temperature",
    "source_radius",
    "soft_source_radius",
    "source_length",
    "source_width",
    "source_height",
    "barn_door_angle",
    "barn_door_length",
    "attenuation_radius",
    "inner_cone_angle",
    "outer_cone_angle",
    "cast_shadows",
    "shadow_bias",
    "specular_scale",
    "diffuse_scale",
    "indirect_lighting_intensity",
    "volumetric_scattering_intensity",
    "light_source_angle",
    "light_source_soft_angle",
    "affects_world",
    "visible",
]


def level_paths() -> list[str]:
    inventory.scan((ROOT,))
    return inventory.find_assets({"World"}, (ROOT,))


def transform_of(actor: unreal.Actor) -> dict[str, list[float]]:
    t = actor.get_actor_transform()
    r = t.rotation.rotator()
    return {
        "location": [t.translation.x, t.translation.y, t.translation.z],
        "rotation_pyr": [r.pitch, r.yaw, r.roll],
        "scale": [t.scale3d.x, t.scale3d.y, t.scale3d.z],
    }


def dump_actor(actor: unreal.Actor) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "name": actor.get_actor_label(),
        "class": actor.get_class().get_name(),
        "transform": transform_of(actor),
        "components": [],
    }
    for component in actor.get_components_by_class(unreal.ActorComponent):
        record: dict[str, Any] = {"class": component.get_class().get_name()}
        if isinstance(component, unreal.LightComponentBase | unreal.SkyLightComponent):
            record.update(ue.dump_properties(component, [*LIGHT_FIELDS, "cubemap", "source_type"]))
        elif isinstance(component, unreal.PostProcessComponent):
            record["settings"] = ue.to_text(component.get_editor_property("settings"))
        elif isinstance(component, unreal.StaticMeshComponent):
            mesh = component.get_editor_property("static_mesh")
            record["static_mesh"] = mesh.get_path_name() if mesh else None
            record["materials"] = [
                m.get_path_name() if m else None for m in component.get_materials()
            ]
        if isinstance(component, unreal.SceneComponent):
            rel = component.get_relative_transform()
            record["relative_location"] = [rel.translation.x, rel.translation.y, rel.translation.z]
            rot = rel.rotation.rotator()
            record["relative_rotation_pyr"] = [rot.pitch, rot.yaw, rot.roll]
        entry["components"].append(record)
    if isinstance(actor, unreal.PostProcessVolume):
        entry["settings"] = ue.to_text(actor.get_editor_property("settings"))
        entry["unbound"] = bool(actor.get_editor_property("unbound"))
    return entry


def export_level(path: str, work: Path) -> dict[str, Any]:
    unreal.EditorLoadingAndSavingUtils.load_map(path.rsplit(".", 1)[0])
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
    dumped = [dump_actor(actor) for actor in actors]
    write_json(work / "lighting.json", {"level": path, "actors": dumped})
    lights = [a for a in dumped if any("Light" in c["class"] for c in a["components"])]
    return {"level": path, "actors": len(dumped), "lights": len(lights)}


def run(archive: Archive, args: dict[str, Any]) -> dict[str, Any]:
    units = [
        Unit(
            name=f"lighting/{path.rsplit('.', 1)[-1]}",
            directory=archive.unit_dir("lighting", path.rsplit(".", 1)[-1]),
            export=lambda work, path=path: export_level(path, work),
        )
        for path in level_paths()
    ]
    log = JobLog(archive.logs, "lighting")
    summary = run_units(units, log, force=bool(args.get("force")), skip=SkipList(archive.skip_file))
    unreal.EditorLoadingAndSavingUtils.new_blank_map(False)
    return {"levels": len(units), "log": str(log.path), **summary.as_dict()}
