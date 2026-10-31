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

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def to_blender(points: list[list[float]]) -> list[tuple[float, float, float]]:
    return [(x, -z, y) for x, y, z in points]


def clear_scene() -> None:
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def mesh_object(
    name: str,
    positions: list[list[float]],
    faces: list[list[int]],
    edges: list[list[int]] | None = None,
) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(to_blender(positions), edges or [], faces)
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
    # Sewn garments: loose edges between the vertex pairs the sewing springs pull together.
    obj = mesh_object("garment", garment["positions"], garment["faces"], garment.get("sew"))
    uv = obj.data.uv_layers.new(name="UVMap")
    corners = [c for face in garment["corner_uvs"] for c in face]
    for loop, (u, v) in zip(uv.data, corners, strict=True):
        loop.uv = (u, 1.0 - v)  # glTF puts v = 0 at the top of the image
    pin = obj.vertex_groups.new(name="pin")
    for index, weight in enumerate(garment["pin"]):
        if weight > 0:
            pin.add([index], weight, "REPLACE")
    if "arm" in garment:
        # Which arm the cloth follows: written into the GLB for the converter.
        attribute = obj.data.attributes.new("_ARM", "FLOAT", "POINT")
        attribute.data.foreach_set("value", [float(a) for a in garment["arm"]])
    if "leg" in garment:
        # Which leg a trouser leg follows, for the converter likewise.
        attribute = obj.data.attributes.new("_LEG", "FLOAT", "POINT")
        attribute.data.foreach_set("value", [float(a) for a in garment["leg"]])
    if "stiff" in garment:
        # Hems, bands and cuffs: folded double and stitched, they bend less.
        stiff = obj.vertex_groups.new(name="stiff")
        for index, weight in enumerate(garment["stiff"]):
            if weight > 0:
                stiff.add([index], weight, "REPLACE")
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    if "rest" in garment:
        # The flat pattern as the cloth's rest shape: spring lengths and bend angles of
        # the pieces as cut, wherever they start.
        obj.shape_key_add(name="Basis", from_mix=False)
        rest = obj.shape_key_add(name="rest", from_mix=False)
        for point, co in zip(rest.data, to_blender(garment["rest"]), strict=True):
            point.co = co
        rest.value = 0.0
    return obj


def simulate(garment: bpy.types.Object, body: bpy.types.Object, sim: dict[str, Any]) -> float:
    collision = body.modifiers.new("Collision", "COLLISION")
    del collision
    body.collision.thickness_outer = sim.get("collision_distance", 0.002)
    body.collision.cloth_friction = sim.get("friction", 5.0)

    cloth = garment.modifiers.new("Cloth", "CLOTH")
    settings = cloth.settings
    settings.quality = int(sim.get("quality", 10))
    settings.mass = sim.get("mass", 0.15)
    settings.tension_stiffness = sim.get("tension", 40.0)
    settings.compression_stiffness = sim.get("compression", 40.0)
    settings.shear_stiffness = sim.get("shear", 20.0)
    settings.bending_stiffness = sim.get("bending", 1.0)
    settings.air_damping = sim.get("air_damping", 2.0)
    settings.vertex_group_mass = "pin"
    if garment.vertex_groups.get("stiff") is not None:
        settings.vertex_group_bending = "stiff"
        settings.bending_stiffness_max = sim.get("band_bending", 10.0 * settings.bending_stiffness)
    settings.pin_stiffness = 1.0
    cloth.collision_settings.distance_min = sim.get("collision_distance", 0.002)
    cloth.collision_settings.use_self_collision = bool(sim.get("self_collision", False))
    cloth.collision_settings.self_distance_min = sim.get("self_distance", 0.002)
    if garment.data.shape_keys is not None:
        settings.rest_shape_key = garment.data.shape_keys.key_blocks["rest"]
    sew_frames = int(sim.get("sew_frames", 0))
    if sew_frames:
        settings.use_sewing_springs = True
        settings.sewing_force_max = sim.get("sewing_force", 0.0)
        # Gravity waits until the seams have closed, then comes in over `ramp` frames.
        ramp = int(sim.get("gravity_ramp", 10))
        path = 'modifiers["Cloth"].settings.effector_weights.gravity'
        settings.effector_weights.gravity = 0.0
        garment.keyframe_insert(data_path=path, frame=1)
        garment.keyframe_insert(data_path=path, frame=sew_frames)
        settings.effector_weights.gravity = 1.0
        garment.keyframe_insert(data_path=path, frame=sew_frames + ramp)

    frames = int(sim.get("frames", 40)) + sew_frames
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


def weld(garment: bpy.types.Object, groups: list[list[int]]) -> dict[str, float]:
    """Join each group of sewn vertices at their mean and drop the sewing edges. Returns
    how far apart the seams still were (metres)."""
    mesh = garment.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.verts.ensure_lookup_table()
    gaps = []
    targets = {}
    for group in groups:
        verts = [bm.verts[i] for i in group]
        center = sum((v.co for v in verts), verts[0].co * 0.0) / len(verts)
        gaps.append(max((v.co - center).length for v in verts) * 2.0)
        for v in verts:
            v.co = center
        for v in verts[1:]:
            targets[v] = verts[0]
    bmesh.ops.weld_verts(bm, targetmap=targets)
    loose = [e for e in bm.edges if not e.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="EDGES")
    # Corners where three or four pieces meet leave slivers; Solidify's even offset
    # would shoot spikes out of them.
    bmesh.ops.dissolve_degenerate(bm, dist=0.0002, edges=bm.edges[:])
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    crowded = sum(1 for e in bm.edges if len(e.link_faces) > 2)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    gaps.sort()
    return {
        "crowded_edges": float(crowded),
        "seam_gap_median": gaps[len(gaps) // 2] if gaps else 0.0,
        "seam_gap_max": gaps[-1] if gaps else 0.0,
    }


def push_out(garment: bpy.types.Object, body: bpy.types.Object, gap: float) -> int:
    """Move cloth vertices closer to the body than `gap` (or under its skin, where arm and
    torso pinch the cloth) out along the skin's normal. Returns how many moved."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    tree = BVHTree.FromObject(body, depsgraph)
    moved = 0
    for vertex in garment.data.vertices:
        hit, normal, _, _ = tree.find_nearest(vertex.co)
        if hit is None:
            continue
        side = (vertex.co - hit).dot(normal)
        if side < gap:
            vertex.co = hit + normal * gap
            moved += 1
    garment.data.update()
    return moved


def smooth(garment: bpy.types.Object, passes: int) -> None:
    """Taubin smoothing (shrink-free): takes out the simulation's small dents and ripples,
    keeps its folds. Open edges are smoothed along themselves only, so hems stay put."""
    if passes <= 0:
        return
    bm = bmesh.new()
    bm.from_mesh(garment.data)
    bm.verts.ensure_lookup_table()
    neighbours = []
    for v in bm.verts:
        if v.is_boundary:
            ring = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
        else:
            ring = [e.other_vert(v) for e in v.link_edges]
        neighbours.append([u.index for u in ring])
    points = [v.co.copy() for v in bm.verts]
    for _ in range(passes):
        for factor in (0.5, -0.53):
            moved = []
            for i, ring in enumerate(neighbours):
                if not ring:
                    moved.append(points[i])
                    continue
                mean = sum((points[j] for j in ring), points[i] * 0.0) / len(ring)
                moved.append(points[i] + factor * (mean - points[i]))
            points = moved
    for v, co in zip(bm.verts, points, strict=True):
        v.co = co
    bm.to_mesh(garment.data)
    bm.free()
    garment.data.update()


def hug(
    garment: bpy.types.Object,
    body: bpy.types.Object,
    centres: list[list[float]],
    radius: float,
    gap: float,
) -> int:
    """Draw the cloth round each centre (glTF axes; the armpits) onto the skin, `gap` off
    it, fully at the centre and not at all `radius` away. Cloth left hanging between arm
    and torso takes its skin weights from both and tears when the arm moves."""
    if not centres:
        return 0
    depsgraph = bpy.context.evaluated_depsgraph_get()
    tree = BVHTree.FromObject(body, depsgraph)
    points = [Vector(c) for c in to_blender(centres)]
    moved = 0
    for vertex in garment.data.vertices:
        reach = min((vertex.co - c).length for c in points)
        if reach >= radius:
            continue
        hit, normal, _, _ = tree.find_nearest(vertex.co)
        if hit is None:
            continue
        t = 1.0 - reach / radius
        share = t * t * (3.0 - 2.0 * t)
        target = hit + normal * gap
        if (vertex.co - hit).dot(normal) > gap:
            vertex.co = vertex.co.lerp(target, share)
            moved += 1
    garment.data.update()
    return moved


def wrap(garment: bpy.types.Object, arm: bpy.types.Object, shares: list[float], gap: float) -> int:
    """Lay the cloth onto the arm's skin, `gap` off it, by each vertex's share."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    tree = BVHTree.FromObject(arm, depsgraph)
    moved = 0
    for vertex, share in zip(garment.data.vertices, shares, strict=False):
        if share <= 0.0:
            continue
        hit, normal, _, _ = tree.find_nearest(vertex.co)
        if hit is None:
            continue
        vertex.co = vertex.co.lerp(hit + normal * gap, share)
        moved += 1
    garment.data.update()
    return moved


def solidify(garment: bpy.types.Object, thickness: float, rim_only: bool = False) -> None:
    modifier = garment.modifiers.new("Solidify", "SOLIDIFY")
    modifier.thickness = thickness
    modifier.offset = 1.0  # outward: faces wind outward
    # Even offset keeps the thickness at creases but shoots spikes out of sharp corners
    # where sewn pieces meet; the clamp holds every offset to the edges around it.
    modifier.use_even_offset = False
    modifier.use_quality_normals = True
    modifier.thickness_clamp = 1.0
    modifier.use_rim = True
    # A single layer with only its open edges thickened: a full inner shell pokes through
    # the outer one where seams crease and shows as dark specks.
    modifier.use_rim_only = rim_only
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
        export_attributes=True,
    )


def main() -> None:
    job_path = Path(sys.argv[sys.argv.index("--") + 1])
    job = json.loads(job_path.read_text(encoding="utf-8"))
    clear_scene()
    body = mesh_object("body", job["body"]["positions"], job["body"]["triangles"])
    garment = build_garment(job)
    seconds = simulate(garment, body, job.get("sim", {}))
    if "debug" in job:
        # The simulated cloth in the job's vertex order, before welding (glTF axes).
        points = [(v.co.x, v.co.z, -v.co.y) for v in garment.data.vertices]
        Path(job["debug"]).write_text(json.dumps(points), encoding="utf-8")
    # Before the weld the vertices are still in the job's order.
    wrapped = 0
    if "wrap" in job["garment"] and job.get("arm_triangles"):
        arm = mesh_object("arm", job["body"]["positions"], job["arm_triangles"])
        wrapped = wrap(
            garment, arm, job["garment"]["wrap"], job.get("sim", {}).get("wrap_gap", 0.003)
        )
    seams = weld(garment, job["garment"].get("welds", []))
    sim = job.get("sim", {})
    hugged = hug(
        garment,
        body,
        job["garment"].get("hug", []),
        sim.get("hug_radius", 0.08),
        sim.get("hug_gap", 0.003),
    )
    smooth(garment, int(sim.get("smooth", 0)))
    # A few rounds: in a crease (the armpit) a push off one skin can bring it near the other.
    pushed = sum(push_out(garment, body, sim.get("min_gap", 0.0015)) for _ in range(3))
    solidify(garment, job.get("thickness", 0.002), bool(sim.get("rim_only", False)))
    # Where the faces wind inward (a few, by the seams) the thickness went inward too.
    pushed += push_out(garment, body, 0.6 * sim.get("min_gap", 0.0015))
    out = Path(job["out"])
    export(garment, job["material"], out)
    report = {
        "out": str(out),
        "sim_seconds": round(seconds, 2),
        **{k: round(v, 5) for k, v in seams.items()},
        "pushed_out": pushed,
        "hugged": hugged,
        "wrapped": wrapped,
        "vertices": len(garment.data.vertices),
        "faces": len(garment.data.polygons),
        "blender": bpy.app.version_string,
    }
    Path(job["report"]).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("GARMENT_SIM", json.dumps(report))


if __name__ == "__main__":
    main()
