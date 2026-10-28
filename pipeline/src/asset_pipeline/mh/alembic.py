"""Read hair curves from an Alembic groom (Ogawa container), without the Alembic library.

Fab groom packages ship their strands as the Alembic file Unreal imported (Houdini's
groom export: `AbcGeom_Curve_v2` objects with `P`, `nVertices` and Unreal's `groom_*`
attributes). The converter only needs the curves of one time sample, so this reads the
Ogawa layout directly:

- a group is `u64 count` + `count` child offsets; an offset with the top bit set is a data
  block (`u64 size` + bytes), otherwise a group;
- the archive root holds versions, the top object (group 2) and the indexed metadata
  (data 5); an object group is its property compound (child 0), its child objects, and
  their headers (last child, data);
- a compound property group is its properties and their headers (last child, data); an
  array property's sample `i` is children `2i` (16-byte digest + values) and `2i + 1`
  (dimensions); a scalar's sample `i` is child `i`.

Ogawa reference: Alembic's `lib/Alembic/AbcCoreOgawa` (`ReadUtil.cpp`, `WriteUtil.cpp`).
"""

import struct
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

DATA_BIT = 1 << 63
DIGEST = 16  # bytes of sample key in front of every non-empty sample
# Alembic POD types by their `PlainOldDataType` value.
POD_DTYPES = {
    0: np.dtype(np.bool_),
    1: np.dtype("<u1"),
    2: np.dtype("<i1"),
    3: np.dtype("<u2"),
    4: np.dtype("<i2"),
    5: np.dtype("<u4"),
    6: np.dtype("<i4"),
    7: np.dtype("<u8"),
    8: np.dtype("<i8"),
    9: np.dtype("<f2"),
    10: np.dtype("<f4"),
    11: np.dtype("<f8"),
}
STRING_POD = 12
CURVE_SCHEMA = "schema=AbcGeom_Curve_v2"
XFORM_SCHEMA = "schema=AbcGeom_Xform_v3"
# Xform operation types (high nibble of each `.ops` byte) and how many values they take.
XFORM_TRANSLATE, XFORM_SCALE, XFORM_MATRIX = 0, 1, 3
XFORM_VALUES = {0: 3, 1: 3, 2: 4, 3: 16, 4: 1, 5: 1, 6: 1}


class AlembicError(ValueError):
    """The file is not an Alembic archive this reader understands."""


@dataclass(frozen=True)
class PropertyHeader:
    name: str
    kind: str  # "compound", "scalar" or "array"
    pod: int = -1
    extent: int = 0
    samples: int = 0
    metadata: str = ""


class _Ogawa:
    def __init__(self, data: bytes) -> None:
        if data[:5] != b"Ogawa":
            raise AlembicError("not an Ogawa Alembic file")
        self.data = data
        self.root = struct.unpack_from("<Q", data, 8)[0]

    def children(self, group: int) -> list[int]:
        if group == 0:
            return []
        count = struct.unpack_from("<Q", self.data, group)[0]
        return list(struct.unpack_from(f"<{count}Q", self.data, group + 8))

    def blob(self, child: int) -> bytes:
        if not child & DATA_BIT:
            raise AlembicError("expected a data block, found a group")
        offset = child & ~DATA_BIT
        if offset == 0:
            return b""
        size = struct.unpack_from("<Q", self.data, offset)[0]
        return self.data[offset + 8 : offset + 8 + size]


def _sized(buffer: bytes, position: int, hint: int) -> tuple[int, int]:
    """A count stored in 1, 2 or 4 bytes (the header's size hint 0, 1, 2)."""
    if hint == 0:
        return buffer[position], position + 1
    if hint == 1:
        return struct.unpack_from("<H", buffer, position)[0], position + 2
    return struct.unpack_from("<I", buffer, position)[0], position + 4


def _indexed_metadata(buffer: bytes) -> list[str]:
    """Metadata strings shared by index (index 0 is the empty string)."""
    out = [""]
    position = 0
    while position < len(buffer):
        size = buffer[position]
        out.append(buffer[position + 1 : position + 1 + size].decode())
        position += 1 + size
    return out


def _object_headers(buffer: bytes, indexed: list[str]) -> list[tuple[str, str]]:
    """(name, metadata) of every child object; the block ends with two 16-byte hashes."""
    out = []
    position = 0
    while position < len(buffer) - 2 * DIGEST:
        size = struct.unpack_from("<I", buffer, position)[0]
        name = buffer[position + 4 : position + 4 + size].decode()
        position += 4 + size
        index = buffer[position]
        position += 1
        if index == 0xFF:
            size = struct.unpack_from("<I", buffer, position)[0]
            metadata = buffer[position + 4 : position + 4 + size].decode()
            position += 4 + size
        else:
            metadata = indexed[index]
        out.append((name, metadata))
    return out


def _property_headers(buffer: bytes, indexed: list[str]) -> list[PropertyHeader]:
    """Bit layout of the info word (AbcCoreOgawa WritePropertyInfo): type 0x3, size hint
    0xc, POD 0xf0, has time sampling 0x100, first/last changed 0x200, extent 0xff000,
    metadata index 0xff00000."""
    out = []
    position = 0
    while position < len(buffer):
        info = struct.unpack_from("<I", buffer, position)[0]
        position += 4
        kind = info & 0x3
        hint = (info & 0xC) >> 2
        pod, extent, samples = -1, 0, 0
        if kind != 0:
            pod = (info & 0xF0) >> 4
            extent = (info & 0xFF000) >> 12
            samples, position = _sized(buffer, position, hint)
            if info & 0x200:
                _, position = _sized(buffer, position, hint)
                _, position = _sized(buffer, position, hint)
            if info & 0x100:
                _, position = _sized(buffer, position, hint)
        size, position = _sized(buffer, position, hint)
        name = buffer[position : position + size].decode()
        position += size
        index = (info & 0xFF00000) >> 20
        if index == 0xFF:
            size, position = _sized(buffer, position, hint)
            metadata = buffer[position : position + size].decode()
            position += size
        else:
            metadata = indexed[index] if index < len(indexed) else ""
        names = {0: "compound", 1: "scalar", 2: "array", 3: "array"}
        out.append(PropertyHeader(name, names[kind], pod, extent, samples, metadata))
    return out


@dataclass(frozen=True)
class _Compound:
    file: _Ogawa
    group: int
    indexed: list[str]

    def properties(self) -> dict[str, tuple[PropertyHeader, int]]:
        children = self.file.children(self.group)
        if not children:
            return {}
        headers = _property_headers(self.file.blob(children[-1]), self.indexed)
        return {h.name: (h, child) for h, child in zip(headers, children[:-1], strict=True)}

    def compound(self, name: str) -> "_Compound | None":
        found = self.properties().get(name)
        if found is None or found[0].kind != "compound":
            return None
        return _Compound(self.file, found[1], self.indexed)

    def array(self, name: str) -> NDArray[np.generic] | None:
        """Sample 0 of an array property, shaped (n, extent) when the extent is over 1."""
        found = self.properties().get(name)
        if found is None:
            return None
        header, group = found
        if header.kind != "array" or header.pod not in POD_DTYPES:
            return None
        samples = self.file.children(group)
        if not samples:
            return None
        raw = self.file.blob(samples[0])[DIGEST:]
        values = np.frombuffer(raw, dtype=POD_DTYPES[header.pod])
        return values.reshape(-1, header.extent) if header.extent > 1 else values

    def scalar(self, name: str) -> NDArray[np.generic] | None:
        found = self.properties().get(name)
        if found is None:
            return None
        header, group = found
        if header.kind != "scalar" or header.pod not in POD_DTYPES:
            return None
        samples = self.file.children(group)
        if not samples:
            return None
        return np.frombuffer(self.file.blob(samples[0])[DIGEST:], dtype=POD_DTYPES[header.pod])


@dataclass(frozen=True)
class Curves:
    """One curves object: its points in the archive's space (Alembic units, as stored)."""

    path: str  # object path, e.g. "/groom/strands/LongHair"
    points: NDArray[np.float32]  # (P, 3)
    counts: NDArray[np.int32]  # (C,) points per curve
    attributes: dict[str, NDArray[np.generic]] = field(default_factory=dict)

    @property
    def offsets(self) -> NDArray[np.int64]:
        """First point of every curve."""
        return np.concatenate([[0], np.cumsum(self.counts, dtype=np.int64)[:-1]])


def _xform_matrix(properties: _Compound) -> NDArray[np.float64]:
    """The object's local matrix (row-vector convention: p' = p @ M) from its `.xform`."""
    xform = properties.compound(".xform")
    matrix = np.eye(4)
    if xform is None:
        return matrix
    ops = xform.scalar(".ops")
    values = xform.scalar(".vals")
    if ops is None or values is None:
        return matrix
    position = 0
    for op in ops.astype(np.int64).tolist():
        kind = op >> 4
        count = XFORM_VALUES.get(kind)
        if count is None:
            raise AlembicError(f"unknown xform op {op}")
        chunk = np.asarray(values[position : position + count], dtype=np.float64)
        position += count
        local = np.eye(4)
        if kind == XFORM_MATRIX:
            local = chunk.reshape(4, 4)
        elif kind == XFORM_TRANSLATE:
            local[3, :3] = chunk
        elif kind == XFORM_SCALE:
            local[[0, 1, 2], [0, 1, 2]] = chunk
        else:
            raise AlembicError(f"xform rotations are not supported (op {op})")
        matrix = local @ matrix  # Alembic applies the ops last-to-first to points
    return matrix


def _walk(
    file: _Ogawa,
    group: int,
    indexed: list[str],
    path: str,
    metadata: str,
    parent: NDArray[np.float64],
) -> Iterator[Curves]:
    children = file.children(group)
    if not children:
        return
    properties = _Compound(file, children[0], indexed)
    world = parent
    if XFORM_SCHEMA in metadata:
        xform = properties.compound(".xform")
        inherits = xform.scalar(".inherits") if xform is not None else None
        base = np.eye(4) if inherits is not None and not bool(inherits[0]) else parent
        world = _xform_matrix(properties) @ base
    if CURVE_SCHEMA in metadata:
        geometry = properties.compound(".geom")
        if geometry is not None:
            points = geometry.array("P")
            counts = geometry.array("nVertices")
            if points is not None and counts is not None:
                homogeneous = np.c_[points.astype(np.float64), np.ones(len(points))]
                placed = (homogeneous @ world)[:, :3].astype(np.float32)
                attributes: dict[str, NDArray[np.generic]] = {}
                params = geometry.compound(".arbGeomParams")
                if params is not None:
                    for name in params.properties():
                        values = params.array(name)
                        if values is not None:
                            attributes[name] = values
                width = geometry.array("width")
                if width is not None:
                    attributes["width"] = width
                yield Curves(path, placed, counts.astype(np.int32), attributes)
    if len(children) > 1 and children[-1] & DATA_BIT:
        headers = _object_headers(file.blob(children[-1]), indexed)
        for (name, child_metadata), child in zip(headers, children[1:-1], strict=True):
            yield from _walk(file, child, indexed, f"{path}/{name}", child_metadata, world)


def read_curves(source: Path | bytes) -> list[Curves]:
    """Every curves object of the archive (first time sample), placed by its xforms."""
    data = source if isinstance(source, bytes) else source.read_bytes()
    file = _Ogawa(data)
    root = file.children(file.root)
    if len(root) < 6:
        raise AlembicError("archive root is incomplete")
    indexed = _indexed_metadata(file.blob(root[5]))
    return list(_walk(file, root[2], indexed, "", "", np.eye(4)))
