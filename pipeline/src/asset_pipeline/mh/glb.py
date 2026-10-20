"""Minimal glTF 2.0 binary (GLB) builder on numpy arrays.

`GlbBuilder` collects one binary buffer and the JSON document; `to_glb()` packs both into a
`.glb`. It only knows glTF, not DNA (see `gltf.py` for that). Rules it enforces:

- buffer views start on 4-byte boundaries; vertex attributes get `target` ARRAY_BUFFER and
  indices ELEMENT_ARRAY_BUFFER, while inverse bind matrices and sparse data get none;
- float accessors carry `min`/`max` when asked (glTF requires them for POSITION, morph
  targets included), computed on the stored float32 values so they match exactly;
- matrices are written column-major (numpy `(N, 4, 4)` row-major input is transposed);
- sparse accessors need at least one entry; an all-zero accessor has no buffer view.
"""

import json
import struct
from typing import Any

import numpy as np
from numpy.typing import NDArray

ARRAY_BUFFER = 34962
ELEMENT_ARRAY_BUFFER = 34963

COMPONENT_TYPES = {
    np.dtype(np.int8): 5120,
    np.dtype(np.uint8): 5121,
    np.dtype(np.int16): 5122,
    np.dtype(np.uint16): 5123,
    np.dtype(np.uint32): 5125,
    np.dtype(np.float32): 5126,
}
ELEMENT_TYPES = {1: "SCALAR", 2: "VEC2", 3: "VEC3", 4: "VEC4", 16: "MAT4"}

# Sampler constants.
LINEAR = 9729
LINEAR_MIPMAP_LINEAR = 9987
REPEAT = 10497


def _columns(values: NDArray[Any]) -> NDArray[Any]:
    """Accessor elements as a 2-D `(count, components)` array."""
    if values.ndim == 1:
        return values.reshape(-1, 1)
    return values.reshape(values.shape[0], int(np.prod(values.shape[1:])))


class GlbBuilder:
    """Accumulates glTF objects; every `add_*` method returns the new object's index."""

    def __init__(self, generator: str) -> None:
        self.document: dict[str, Any] = {"asset": {"version": "2.0", "generator": generator}}
        self._parts: list[bytes] = []
        self._length = 0

    def _append(self, key: str, item: dict[str, Any]) -> int:
        items = self.document.setdefault(key, [])
        items.append(item)
        return len(items) - 1

    # ------------------------------------------------------------------------ binary data

    def add_buffer_view(self, data: bytes, *, target: int | None = None) -> int:
        padding = -self._length % 4
        if padding:
            self._parts.append(b"\0" * padding)
            self._length += padding
        view: dict[str, Any] = {"buffer": 0, "byteOffset": self._length, "byteLength": len(data)}
        if target is not None:
            view["target"] = target
        self._parts.append(data)
        self._length += len(data)
        return self._append("bufferViews", view)

    def add_accessor(
        self,
        values: NDArray[Any],
        *,
        target: int | None = None,
        bounds: bool = False,
        normalized: bool = False,
    ) -> int:
        """Accessor over `values` `(count,)` or `(count, components)` in their dtype."""
        values = np.ascontiguousarray(values)
        if values.dtype not in COMPONENT_TYPES:
            raise TypeError(f"unsupported accessor dtype {values.dtype}")
        columns = _columns(values)
        accessor: dict[str, Any] = {
            "bufferView": self.add_buffer_view(
                columns.astype(columns.dtype.newbyteorder("<")).tobytes(), target=target
            ),
            "componentType": COMPONENT_TYPES[values.dtype],
            "count": int(columns.shape[0]),
            "type": ELEMENT_TYPES[columns.shape[1]],
        }
        if normalized:
            accessor["normalized"] = True
        if bounds:
            accessor["min"] = columns.min(axis=0).tolist()
            accessor["max"] = columns.max(axis=0).tolist()
        return self._append("accessors", accessor)

    def add_matrices(self, matrices: NDArray[np.float64]) -> int:
        """MAT4 accessor (e.g. inverse bind matrices) from row-major `(N, 4, 4)` arrays."""
        column_major = np.ascontiguousarray(np.transpose(matrices, (0, 2, 1)), dtype=np.float32)
        return self.add_accessor(column_major.reshape(-1, 16))

    def add_zero_accessor(self, count: int, components: int, *, bounds: bool) -> int:
        """Float accessor that is all zeros (no buffer view), e.g. an unaffected morph target."""
        accessor: dict[str, Any] = {
            "componentType": COMPONENT_TYPES[np.dtype(np.float32)],
            "count": count,
            "type": ELEMENT_TYPES[components],
        }
        if bounds:
            accessor["min"] = [0.0] * components
            accessor["max"] = [0.0] * components
        return self._append("accessors", accessor)

    def add_sparse_accessor(
        self, count: int, indices: NDArray[Any], values: NDArray[np.float32], *, bounds: bool
    ) -> int:
        """Float accessor that is zero except `values` at strictly increasing `indices`."""
        values = np.ascontiguousarray(values, dtype=np.float32)
        columns = _columns(values)
        components = columns.shape[1]
        if len(indices) == 0:
            return self.add_zero_accessor(count, components, bounds=bounds)
        indices = np.asarray(indices)
        if np.any(np.diff(indices) <= 0) or indices[0] < 0 or indices[-1] >= count:
            raise ValueError("sparse indices must be strictly increasing and within count")
        index_dtype = np.uint16 if count <= 65535 else np.uint32
        accessor: dict[str, Any] = {
            "componentType": COMPONENT_TYPES[np.dtype(np.float32)],
            "count": count,
            "type": ELEMENT_TYPES[components],
            "sparse": {
                "count": len(indices),
                "indices": {
                    "bufferView": self.add_buffer_view(indices.astype(index_dtype).tobytes()),
                    "componentType": COMPONENT_TYPES[np.dtype(index_dtype)],
                },
                "values": {"bufferView": self.add_buffer_view(columns.tobytes())},
            },
        }
        if bounds:
            low, high = columns.min(axis=0), columns.max(axis=0)
            if len(indices) < count:  # the implicit zeros count too
                low, high = np.minimum(low, 0), np.maximum(high, 0)
            accessor["min"] = low.tolist()
            accessor["max"] = high.tolist()
        return self._append("accessors", accessor)

    # ------------------------------------------------------------------------ objects

    def add_node(self, node: dict[str, Any]) -> int:
        return self._append("nodes", node)

    def add_mesh(self, mesh: dict[str, Any]) -> int:
        return self._append("meshes", mesh)

    def add_skin(self, skin: dict[str, Any]) -> int:
        return self._append("skins", skin)

    def add_material(self, material: dict[str, Any]) -> int:
        return self._append("materials", material)

    def add_image(self, uri: str) -> int:
        """Image referenced by a URI relative to the GLB file."""
        return self._append("images", {"uri": uri})

    def add_sampler(self) -> int:
        return self._append(
            "samplers",
            {
                "magFilter": LINEAR,
                "minFilter": LINEAR_MIPMAP_LINEAR,
                "wrapS": REPEAT,
                "wrapT": REPEAT,
            },
        )

    def add_texture(self, image: int, sampler: int) -> int:
        return self._append("textures", {"source": image, "sampler": sampler})

    def add_scene(self, nodes: list[int], extras: dict[str, Any] | None = None) -> int:
        scene: dict[str, Any] = {"nodes": nodes}
        if extras:
            scene["extras"] = extras
        index = self._append("scenes", scene)
        self.document["scene"] = index
        return index

    # ------------------------------------------------------------------------ output

    def to_glb(self) -> bytes:
        binary = b"".join(self._parts)
        binary += b"\0" * (-len(binary) % 4)
        if binary:
            self.document["buffers"] = [{"byteLength": len(binary)}]
        text = json.dumps(self.document, separators=(",", ":"), allow_nan=False).encode("utf-8")
        text += b" " * (-len(text) % 4)
        chunks = struct.pack("<I4s", len(text), b"JSON") + text
        if binary:
            chunks += struct.pack("<I4s", len(binary), b"BIN\0") + binary
        return struct.pack("<4sII", b"glTF", 2, 12 + len(chunks)) + chunks


def read_glb(data: bytes) -> tuple[dict[str, Any], bytes]:
    """Split a GLB into its JSON document and binary chunk (for tests and inspection)."""
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF" or version != 2 or length != len(data):
        raise ValueError("not a glTF 2.0 binary")
    offset, document, binary = 12, None, b""
    while offset < length:
        size, kind = struct.unpack_from("<I4s", data, offset)
        chunk = data[offset + 8 : offset + 8 + size]
        if kind == b"JSON":
            document = json.loads(chunk)
        elif kind == b"BIN\0":
            binary = chunk
        offset += 8 + size
    if document is None:
        raise ValueError("GLB has no JSON chunk")
    return document, binary


def accessor_array(document: dict[str, Any], binary: bytes, index: int) -> NDArray[Any]:
    """Dense numpy view of an accessor (sparse substitution included)."""
    accessor = document["accessors"][index]
    dtype = {v: k for k, v in COMPONENT_TYPES.items()}[accessor["componentType"]]
    width = {v: k for k, v in ELEMENT_TYPES.items()}[accessor["type"]]
    count = accessor["count"]
    if "bufferView" in accessor:
        view = document["bufferViews"][accessor["bufferView"]]
        start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        array = np.frombuffer(binary, dtype=dtype, count=count * width, offset=start).copy()
        array = array.reshape(count, width)
    else:
        array = np.zeros((count, width), dtype=dtype)
    sparse = accessor.get("sparse")
    if sparse:
        index_view = document["bufferViews"][sparse["indices"]["bufferView"]]
        index_dtype = {v: k for k, v in COMPONENT_TYPES.items()}[sparse["indices"]["componentType"]]
        indices = np.frombuffer(
            binary, dtype=index_dtype, count=sparse["count"], offset=index_view.get("byteOffset", 0)
        )
        value_view = document["bufferViews"][sparse["values"]["bufferView"]]
        values = np.frombuffer(
            binary,
            dtype=dtype,
            count=sparse["count"] * width,
            offset=value_view.get("byteOffset", 0),
        ).reshape(-1, width)
        array[indices.astype(np.int64)] = values
    return array
