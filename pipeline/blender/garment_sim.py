"""Drape a drafted garment in Blender and write it as a GLB (run headless by
`asset_pipeline.garments.blender`).

    blender --background --factory-startup --python garment_sim.py -- <job.json>

The job holds the garment mesh (rest shape, UVs per face corner, pin weights) and the
outfit-base body as a collider, both in glTF space (Y up). Blender is Z up, so positions
come in as (x, -z, y), which its glTF exporter turns back. The garment is pinned at its
waistband, settles under gravity against the body, gets its thickness from Solidify and is
written unskinned with transforms applied; the converter transfers weights and morphs.
"""

import json
import sys
import time
from pathlib import Path
from typing import Any

import bpy


def to_blender(points: list[list[float]]) -> list[tuple[float, float, float]]:
    return [(x, -z, y) for x, y, z in points]


def clear_scene() -> None:
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def mesh_object(
    name: str, positions: list[list[float]], faces: list[list[int]]
) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(to_blender(positions), [], faces)
    mesh.validate()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def bake(obj: bpy.types.Object) -> None:
    """Replace the object's mesh with its evaluated one and drop its modifiers."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(evaluated, depsgraph=depsgraph)
    old = obj.data
    obj.modifiers.clear()
    obj.data = mesh
    bpy.data.meshes.remove(old)


def build_garment(job: dict[str, Any]) -> bpy.types.Object:
    garment = job["garment"]
    obj = mesh_object("garment", garment["positions"], garment["faces"])
    uv = obj.data.uv_layers.new(name="UVMap")
    corners = [c for face in garment["corner_uvs"] for c in face]
    for loop, (u, v) in zip(uv.data, corners, strict=True):
        loop.uv = (u, 1.0 - v)  # glTF puts v = 0 at the top of the image
    pin = obj.vertex_groups.new(name="pin")
    for index, weight in enumerate(garment["pin"]):
        if weight > 0:
            pin.add([index], weight, "REPLACE")
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def simulate(garment: bpy.types.Object, body: bpy.types.Object, sim: dict[str, Any]) -> float:
    collision = body.modifiers.new("Collision", "COLLISION")
    del collision
    body.collision.thickness_outer = sim.get("collision_distance", 0.002)
    body.collision.cloth_friction = sim.get("friction", 5.0)

    cloth = garment.modifiers.new("Cloth", "CLOTH")
    settings = cloth.settings
    settings.quality = sim.get("quality", 10)
    settings.mass = sim.get("mass", 0.15)
    settings.tension_stiffness = sim.get("tension", 40.0)
    settings.compression_stiffness = sim.get("compression", 40.0)
    settings.shear_stiffness = sim.get("shear", 20.0)
    settings.bending_stiffness = sim.get("bending", 1.0)
    settings.air_damping = sim.get("air_damping", 2.0)
    settings.vertex_group_mass = "pin"
    settings.pin_stiffness = 1.0
    cloth.collision_settings.distance_min = sim.get("collision_distance", 0.002)
    cloth.collision_settings.use_self_collision = False

    frames = int(sim.get("frames", 40))
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = frames
    cloth.point_cache.frame_start = 1
    cloth.point_cache.frame_end = frames
    start = time.perf_counter()
    for frame in range(1, frames + 1):
        scene.frame_set(frame)
    elapsed = time.perf_counter() - start
    bake(garment)
    return elapsed


def solidify(garment: bpy.types.Object, thickness: float) -> None:
    modifier = garment.modifiers.new("Solidify", "SOLIDIFY")
    modifier.thickness = thickness
    modifier.offset = 1.0  # outward: faces wind outward
    modifier.use_even_offset = True
    modifier.use_rim = True
    bake(garment)


def export(garment: bpy.types.Object, material_name: str, out: Path) -> None:
    material = bpy.data.materials.new(material_name)
    garment.data.materials.clear()
    garment.data.materials.append(material)
    for obj in bpy.context.scene.objects:
        obj.select_set(obj == garment)
    bpy.context.view_layer.objects.active = garment
    out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(out),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_skins=False,
        export_animations=False,
    )


def main() -> None:
    job_path = Path(sys.argv[sys.argv.index("--") + 1])
    job = json.loads(job_path.read_text(encoding="utf-8"))
    clear_scene()
    body = mesh_object("body", job["body"]["positions"], job["body"]["triangles"])
    garment = build_garment(job)
    seconds = simulate(garment, body, job.get("sim", {}))
    solidify(garment, job.get("thickness", 0.002))
    out = Path(job["out"])
    export(garment, job["material"], out)
    report = {
        "out": str(out),
        "sim_seconds": round(seconds, 2),
        "vertices": len(garment.data.vertices),
        "faces": len(garment.data.polygons),
        "blender": bpy.app.version_string,
    }
    Path(job["report"]).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("GARMENT_SIM", json.dumps(report))


if __name__ == "__main__":
    main()
