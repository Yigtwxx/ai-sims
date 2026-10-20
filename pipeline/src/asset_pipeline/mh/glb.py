"""Minimal glTF 2.0 binary (GLB) builder on numpy arrays.

`GlbBuilder` collects one binary buffer and the JSON document; `to_glb()` packs both into a
`.glb`. It only knows glTF, not DNA (see `gltf.py` for that). Rules it enforces:

- buffer views start on 4-byte boundaries; vertex attributes get `target` ARRAY_BUFFER and
  indices ELEMENT_ARRAY_BUFFER, while inverse bind matrices, animation and sparse data get
  none;
- vertex attributes whose element is not a multiple of 4 bytes (e.g. a normalized SHORT
  VEC3) are padded to the next multiple and get a `byteStride`, as glTF requires;
- accessors carry `min`/`max` when asked (glTF requires them for POSITION, morph targets
  included), computed on the stored values (integers for normalized accessors);
- matrices are written column-major (numpy `(N, 4, 4)` row-major input is transposed);
- with `compress=True`, every non-index buffer view whose element size is a multiple of 4
  is stored with EXT_meshopt_compression (`ATTRIBUTES` mode, no filter); the uncompressed
  layout lives in a data-less fallback buffer, so the extension becomes required. Data is
  never reordered.
"""

import json
import struct
from typing import Any

import numpy as np
from numpy.typing import NDArray

from asset_pipeline.mh.meshopt import decode_attributes, encode_attributes

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
DTYPES = {code: dtype for dtype, code in COMPONENT_TYPES.items()}
ELEMENT_TYPES = {1: "SCALAR", 2: "VEC2", 3: "VEC3", 4: "VEC4", 16: "MAT4"}
WIDTHS = {name: width for width, name in ELEMENT_TYPES.items()}

MESHOPT = "EXT_meshopt_compression"
QUANTIZATION = "KHR_mesh_quantization"
BASISU = "KHR_texture_basisu"
# Views smaller than this stay uncompressed (the stream tail alone is 32 bytes).
MIN_COMPRESSED_BYTES = 256

# Sampler constants.
LINEAR = 9729
LINEAR_MIPMAP_LINEAR = 9987
REPEAT = 10497


def _columns(values: NDArray[Any]) -> NDArray[Any]:
    """Accessor elements as a 2-D `(count, components)` array."""
    if values.ndim == 1:
        return values.reshape(-1, 1)
    return values.reshape(values.shape[0], int(np.prod(values.shape[1:])))


def _padded_bytes(columns: NDArray[Any], stride: int) -> bytes:
    """Little-endian element bytes, each element zero-padded to `stride` bytes."""
    little = np.ascontiguousarray(columns.astype(columns.dtype.newbyteorder("<")))
    raw = little.view(np.uint8).reshape(len(columns), -1)
    if raw.shape[1] == stride:
        return raw.tobytes()
    padded = np.zeros((len(columns), stride), dtype=np.uint8)
    padded[:, : raw.shape[1]] = raw
    return padded.tobytes()


def quantize_snorm16(values: NDArray[Any]) -> NDArray[np.int16]:
    """Signed normalized 16-bit (glTF decodes `max(q / 32767, -1)`); clamps to [-1, 1]."""
    clipped = np.clip(np.asarray(values, dtype=np.float64), -1.0, 1.0)
    return np.round(clipped * 32767.0).astype(np.int16)


def quantize_unorm16(values: NDArray[Any]) -> NDArray[np.uint16]:
    """Unsigned normalized 16-bit; clamps to [0, 1]."""
    clipped = np.clip(np.asarray(values, dtype=np.float64), 0.0, 1.0)
    return np.round(clipped * 65535.0).astype(np.uint16)


def quantize_weights(weights: NDArray[Any]) -> NDArray[np.uint16]:
    """Skin weights as normalized UNSIGNED_SHORT rows that sum to exactly 65535."""
    weights = np.asarray(weights, dtype=np.float64)
    totals = weights.sum(axis=1, keepdims=True)
    scaled = weights / np.where(totals > 0, totals, 1.0) * 65535.0
    quantized = np.floor(scaled).astype(np.int64)
    remainder = 65535 - quantized.sum(axis=1)
    # Hand the rounding remainder to the largest fractional parts, row by row.
    order = np.argsort(-(scaled - quantized), axis=1, kind="stable")
    ranks = np.argsort(order, axis=1, kind="stable")
    quantized += ranks < remainder[:, None]
    return quantized.astype(np.uint16)


def denormalize(values: NDArray[Any]) -> NDArray[np.float64]:
    """glTF normalized integer -> float."""
    if values.dtype == np.int8:
        return np.maximum(values / 127.0, -1.0)
    if values.dtype == np.uint8:
        return values / 255.0
    if values.dtype == np.int16:
        return np.maximum(values / 32767.0, -1.0)
    if values.dtype == np.uint16:
        return values / 65535.0
    raise TypeError(f"{values.dtype} is not a normalized component type")


class GlbBuilder:
    """Accumulates glTF objects; every `add_*` method returns the new object's index."""

    def __init__(self, generator: str, *, compress: bool = False) -> None:
        self.document: dict[str, Any] = {"asset": {"version": "2.0", "generator": generator}}
        self.compress = compress
        self._parts: list[bytes] = []
        self._length = 0
        self._fallback_length = 0
        self._used: list[str] = []
        self._required: list[str] = []
        self.raw_bytes = 0  # uncompressed size of every view, for reports

    def _append(self, key: str, item: dict[str, Any]) -> int:
        items = self.document.setdefault(key, [])
        items.append(item)
        return len(items) - 1

    def use_extension(self, name: str, *, required: bool = True) -> None:
        if name not in self._used:
            self._used.append(name)
        if required and name not in self._required:
            self._required.append(name)

    # ------------------------------------------------------------------------ binary data

    def _place(self, data: bytes) -> int:
        padding = -self._length % 4
        if padding:
            self._parts.append(b"\0" * padding)
            self._length += padding
        offset = self._length
        self._parts.append(data)
        self._length += len(data)
        return offset

    def add_buffer_view(
        self,
        data: bytes,
        *,
        target: int | None = None,
        byte_stride: int | None = None,
        element_size: int | None = None,
    ) -> int:
        """A view over `data` (uncompressed bytes). `element_size` enables compression of
        non-index data; `byte_stride` is written for padded vertex attributes."""
        self.raw_bytes += len(data)
        view: dict[str, Any] = {}
        size = element_size or byte_stride
        compressible = (
            self.compress
            and target != ELEMENT_ARRAY_BUFFER
            and size is not None
            and size % 4 == 0
            and size <= 256
            and len(data) >= MIN_COMPRESSED_BYTES
            and len(data) % size == 0
        )
        if compressible:
            assert size is not None
            stream = encode_attributes(data, size)
            offset = self._place(stream)
            self.use_extension(MESHOPT)
            view = {"buffer": 1, "byteOffset": self._fallback_length, "byteLength": len(data)}
            self._fallback_length += len(data) + (-len(data) % 4)
            view["extensions"] = {
                MESHOPT: {
                    "buffer": 0,
                    "byteOffset": offset,
                    "byteLength": len(stream),
                    "byteStride": size,
                    "mode": "ATTRIBUTES",
                    "count": len(data) // size,
                }
            }
        else:
            view = {"buffer": 0, "byteOffset": self._place(data), "byteLength": len(data)}
        if byte_stride is not None:
            view["byteStride"] = byte_stride
        if target is not None:
            view["target"] = target
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
        element = columns.shape[1] * values.dtype.itemsize
        stride = element
        byte_stride = None
        if target == ARRAY_BUFFER and element % 4:
            stride = element + (-element % 4)
            byte_stride = stride
        accessor: dict[str, Any] = {
            "bufferView": self.add_buffer_view(
                _padded_bytes(columns, stride),
                target=target,
                byte_stride=byte_stride,
                element_size=stride,
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

    def add_zero_accessor(
        self,
        count: int,
        components: int,
        *,
        bounds: bool,
        dtype: np.dtype[Any] | type = np.float32,
        normalized: bool = False,
    ) -> int:
        """Accessor that is all zeros (no buffer view), e.g. an unaffected morph target."""
        accessor: dict[str, Any] = {
            "componentType": COMPONENT_TYPES[np.dtype(dtype)],
            "count": count,
            "type": ELEMENT_TYPES[components],
        }
        if normalized:
            accessor["normalized"] = True
        if bounds:
            zero: float | int = 0.0 if np.dtype(dtype) == np.float32 else 0
            accessor["min"] = [zero] * components
            accessor["max"] = [zero] * components
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

    def add_animation(self, animation: dict[str, Any]) -> int:
        return self._append("animations", animation)

    def add_image(self, uri: str, mime_type: str | None = None) -> int:
        """Image referenced by a URI relative to the GLB file."""
        image: dict[str, Any] = {"uri": uri}
        if mime_type:
            image["mimeType"] = mime_type
        return self._append("images", image)

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

    def add_basisu_texture(self, image: int, sampler: int) -> int:
        """Texture whose only source is a KTX2 image (KHR_texture_basisu, required)."""
        self.use_extension(BASISU)
        return self._append(
            "textures", {"sampler": sampler, "extensions": {BASISU: {"source": image}}}
        )

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
        buffers: list[dict[str, Any]] = []
        if binary or self._fallback_length:
            buffers.append({"byteLength": len(binary)})
        if self._fallback_length:
            buffers.append(
                {"byteLength": self._fallback_length, "extensions": {MESHOPT: {"fallback": True}}}
            )
        if buffers:
            self.document["buffers"] = buffers
        if self._used:
            self.document["extensionsUsed"] = list(self._used)
        if self._required:
            self.document["extensionsRequired"] = list(self._required)
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


def view_bytes(document: dict[str, Any], binary: bytes, index: int) -> bytes:
    """Uncompressed bytes of a buffer view of a GLB (meshopt views are decoded)."""
    view = document["bufferViews"][index]
    meshopt = view.get("extensions", {}).get(MESHOPT)
    if meshopt:
        if meshopt.get("mode", "ATTRIBUTES") != "ATTRIBUTES" or meshopt.get("filter", "NONE") != (
            "NONE"
        ):
            raise ValueError("only unfiltered ATTRIBUTES meshopt views are supported")
        start = meshopt.get("byteOffset", 0)
        stream = binary[start : start + meshopt["byteLength"]]
        return decode_attributes(stream, meshopt["count"], meshopt["byteStride"])
    if view.get("buffer", 0) != 0:
        raise ValueError("buffer view outside the GLB binary chunk")
    start = view.get("byteOffset", 0)
    return binary[start : start + view["byteLength"]]


def accessor_array(document: dict[str, Any], binary: bytes, index: int) -> NDArray[Any]:
    """Dense numpy copy of an accessor in its stored type (sparse substitution included)."""
    accessor = document["accessors"][index]
    dtype = DTYPES[accessor["componentType"]]
    width = WIDTHS[accessor["type"]]
    count = accessor["count"]
    if "bufferView" in accessor:
        view = document["bufferViews"][accessor["bufferView"]]
        data = view_bytes(document, binary, accessor["bufferView"])
        element = width * dtype.itemsize
        stride = view.get("byteStride", element)
        start = accessor.get("byteOffset", 0)
        raw = np.frombuffer(data, dtype=np.uint8)
        rows = np.lib.stride_tricks.as_strided(
            raw[start:], shape=(count, element), strides=(stride, 1)
        )
        array = np.ascontiguousarray(rows).view(dtype).reshape(count, width).copy()
    else:
        array = np.zeros((count, width), dtype=dtype)
    sparse = accessor.get("sparse")
    if sparse:
        index_dtype = DTYPES[sparse["indices"]["componentType"]]
        index_data = view_bytes(document, binary, sparse["indices"]["bufferView"])
        indices = np.frombuffer(
            index_data,
            dtype=index_dtype,
            count=sparse["count"],
            offset=sparse["indices"].get("byteOffset", 0),
        )
        value_data = view_bytes(document, binary, sparse["values"]["bufferView"])
        values = np.frombuffer(
            value_data,
            dtype=dtype,
            count=sparse["count"] * width,
            offset=sparse["values"].get("byteOffset", 0),
        ).reshape(-1, width)
        array[indices.astype(np.int64)] = values
    return array


def accessor_values(document: dict[str, Any], binary: bytes, index: int) -> NDArray[np.float64]:
    """Accessor as float64, normalized integers mapped to their glTF float value."""
    array = accessor_array(document, binary, index)
    if document["accessors"][index].get("normalized"):
        return denormalize(array)
    return array.astype(np.float64)
