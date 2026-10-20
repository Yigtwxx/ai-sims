"""Mesh geometry helpers: closest points on triangle meshes and connected components."""

import numpy as np
from numpy.typing import NDArray
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

F64 = NDArray[np.float64]
I64 = NDArray[np.int64]


def closest_point_on_triangles(points: F64, a: F64, b: F64, c: F64) -> tuple[F64, F64]:
    """Closest points of `points` (N, 3) on triangles (N, 3) x3, vectorised (Ericson,
    Real-Time Collision Detection 5.1.5). Returns (closest points, barycentrics (N, 3))."""
    ab, ac, ap = b - a, c - a, points - a
    d1 = np.einsum("ij,ij->i", ab, ap)
    d2 = np.einsum("ij,ij->i", ac, ap)
    bp = points - b
    d3 = np.einsum("ij,ij->i", ab, bp)
    d4 = np.einsum("ij,ij->i", ac, bp)
    cp = points - c
    d5 = np.einsum("ij,ij->i", ab, cp)
    d6 = np.einsum("ij,ij->i", ac, cp)
    va = d3 * d6 - d5 * d4
    vb = d5 * d2 - d1 * d6
    vc = d1 * d4 - d3 * d2

    bary = np.zeros((len(points), 3))
    done = np.zeros(len(points), dtype=bool)

    def take(mask: NDArray[np.bool_], weights: F64) -> None:
        mask = mask & ~done
        bary[mask] = weights[mask]
        done[mask] = True

    ones, zeros = np.ones(len(points)), np.zeros(len(points))
    take((d1 <= 0) & (d2 <= 0), np.stack([ones, zeros, zeros], axis=1))
    take((d3 >= 0) & (d4 <= d3), np.stack([zeros, ones, zeros], axis=1))
    take((d6 >= 0) & (d5 <= d6), np.stack([zeros, zeros, ones], axis=1))
    with np.errstate(divide="ignore", invalid="ignore"):
        v = d1 / (d1 - d3)
        take((vc <= 0) & (d1 >= 0) & (d3 <= 0), np.stack([1 - v, v, zeros], axis=1))
        w = d2 / (d2 - d6)
        take((vb <= 0) & (d2 >= 0) & (d6 <= 0), np.stack([1 - w, zeros, w], axis=1))
        w = (d4 - d3) / ((d4 - d3) + (d5 - d6))
        take((va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0), np.stack([zeros, 1 - w, w], axis=1))
        denominator = 1.0 / (va + vb + vc)
        v, w = vb * denominator, vc * denominator
        take(np.ones(len(points), dtype=bool), np.stack([1 - v - w, v, w], axis=1))
    bary = np.nan_to_num(bary, nan=1.0 / 3.0)
    closest = bary[:, :1] * a + bary[:, 1:2] * b + bary[:, 2:] * c
    return closest, bary


def closest_triangles(
    points: F64, vertices: F64, triangles: I64, candidates: int = 24
) -> tuple[I64, F64, F64]:
    """For every point the nearest triangle among the `candidates` with the closest
    centroids. Returns (triangle index, barycentrics (N, 3), distance)."""
    centroids = vertices[triangles].mean(axis=1)
    count = min(candidates, len(triangles))
    _, near = cKDTree(centroids).query(points, k=count)
    near = near.reshape(len(points), count)
    best = np.full(len(points), np.inf)
    best_triangle = np.zeros(len(points), dtype=np.int64)
    best_bary = np.zeros((len(points), 3))
    for column in range(count):
        tri = triangles[near[:, column]]
        closest, bary = closest_point_on_triangles(
            points, vertices[tri[:, 0]], vertices[tri[:, 1]], vertices[tri[:, 2]]
        )
        distance = np.linalg.norm(points - closest, axis=1)
        better = distance < best
        best[better] = distance[better]
        best_triangle[better] = near[better, column]
        best_bary[better] = bary[better]
    return best_triangle, best_bary, best


def components(count: int, triangles: I64) -> I64:
    """Connected component label of every vertex (vertices joined by triangle edges)."""
    rows = np.concatenate([triangles[:, 0], triangles[:, 1], triangles[:, 2]])
    cols = np.concatenate([triangles[:, 1], triangles[:, 2], triangles[:, 0]])
    graph = coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(count, count))
    _, labels = connected_components(graph, directed=False)
    return labels.astype(np.int64)


def vertex_normals(vertices: F64, triangles: I64) -> F64:
    """Area-weighted unit vertex normals."""
    a, b, c = (vertices[triangles[:, k]] for k in range(3))
    face = np.cross(b - a, c - a)
    normals = np.zeros_like(vertices)
    for k in range(3):
        np.add.at(normals, triangles[:, k], face)
    length = np.linalg.norm(normals, axis=1, keepdims=True)
    return normals / np.where(length > 0, length, 1.0)
