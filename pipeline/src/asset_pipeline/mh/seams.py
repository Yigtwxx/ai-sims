"""Open boundaries and the neck seam of DNA meshes (shared by GLB writing and textures)."""

from typing import Any

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

from asset_pipeline.mh.bake import mesh_kind
from asset_pipeline.mh.dna import Mesh
from asset_pipeline.mh.gltf import Space

SEAM_RINGS = 4


class SeamError(ValueError):
    """A mesh has no open boundary where a seam is expected."""


def _edges(mesh: Mesh) -> np.ndarray:
    """Undirected polygon edges `(E, 2)` between DNA position indices (unique, sorted)."""
    corners = mesh.layout_positions[mesh.face_layouts]
    following = np.arange(len(corners)) + 1
    ends = mesh.face_offsets[1:]
    following[ends - 1] = mesh.face_offsets[:-1]  # wrap each polygon around
    return np.sort(np.stack([corners, corners[following]], axis=1), axis=1)


def boundary_loops(mesh: Mesh) -> list[np.ndarray]:
    """Position indices of each open boundary (edges used by one polygon), walked in order."""
    pairs = _edges(mesh)
    keys, counts = np.unique(
        pairs[:, 0].astype(np.int64) * len(mesh.positions) + pairs[:, 1], return_counts=True
    )
    boundary = keys[counts == 1]
    a, b = boundary // len(mesh.positions), boundary % len(mesh.positions)
    if not len(a):
        return []
    size = len(mesh.positions)
    graph = coo_matrix((np.ones(len(a)), (a, b)), shape=(size, size))
    _, labels = connected_components(graph, directed=False)
    neighbours: dict[int, list[int]] = {}
    for start, end in zip(a.tolist(), b.tolist(), strict=True):
        neighbours.setdefault(start, []).append(end)
        neighbours.setdefault(end, []).append(start)
    loops = []
    for label in np.unique(labels[np.concatenate([a, b])]):
        members = sorted(v for v in neighbours if labels[v] == label)
        walk, previous, current = [members[0]], -1, members[0]
        while True:
            options = [v for v in neighbours[current] if v != previous]
            if not options or options[0] == walk[0] or len(walk) > len(members):
                break
            previous, current = current, options[0]
            walk.append(current)
        loops.append(np.array(walk if len(walk) == len(members) else members, dtype=np.int64))
    return loops


def neck_seam(mesh: Mesh, space: Space, *, lowest: bool, rings: int = SEAM_RINGS) -> dict[str, Any]:
    """The open boundary at the neck (lowest loop of a head, highest of a body) plus `rings`
    rings of neighbours with falling weights (1 at the seam)."""
    loops = boundary_loops(mesh)
    if not loops:
        raise SeamError(f"{mesh.name} has no open boundary for a neck seam")
    height = space.points(mesh.positions)[:, 1]
    by_height = sorted(loops, key=lambda members: float(height[members].mean()))
    loop = by_height[0] if lowest else by_height[-1]
    pairs = _edges(mesh)
    size = len(mesh.positions)
    adjacency = coo_matrix(
        (
            np.ones(2 * len(pairs)),
            (np.r_[pairs[:, 0], pairs[:, 1]], np.r_[pairs[:, 1], pairs[:, 0]]),
        ),
        shape=(size, size),
    ).tocsr()
    ring = np.full(size, -1, dtype=np.int64)
    ring[loop] = 0
    frontier = loop
    for step in range(1, rings + 1):
        reached = np.unique(adjacency[frontier].indices)
        reached = reached[ring[reached] < 0]
        ring[reached] = step
        frontier = reached
    positions = np.flatnonzero(ring >= 0)
    weights = 1.0 - ring[positions] / (rings + 1)
    weight_of = dict(zip(positions.tolist(), weights.tolist(), strict=True))
    vertices = np.flatnonzero(ring[mesh.layout_positions] >= 0)
    return {
        "primitive": mesh_kind(mesh.name),
        "boundary": loop.tolist(),
        "positions": positions.tolist(),
        "position_weights": [round(w, 4) for w in weights.tolist()],
        "vertices": vertices.tolist(),
        "weights": [round(weight_of[int(p)], 4) for p in mesh.layout_positions[vertices].tolist()],
        "rings": rings,
        "note": "boundary/positions are DNA position indices; vertices index the primitive",
    }
