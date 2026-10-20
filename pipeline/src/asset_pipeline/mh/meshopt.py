"""EXT_meshopt_compression attribute codec (bitstream version 0, mode `ATTRIBUTES`).

Implements Appendix A ("Mode 0: attributes") of the extension spec: elements are split into
blocks, each block stores one byte-plane per element byte as zigzag-encoded deltas from
the previous element, in groups of 16 with a 2-bit mode per group (all zero, 2-bit or
4-bit sentinel coding, raw bytes). The tail holds the baseline element (the first one)
right-aligned in at least 32 bytes.

The encoder is vectorised with numpy and never reorders data, so vertex indices stored
elsewhere (neck seams, `_DNA_POSITION`) stay valid. The decoder is a plain reference
implementation for tests and QA (it loops per group).
"""

import numpy as np

HEADER = 0xA0
GROUP = 16
TAIL = 32
MAX_STRIDE = 256


class MeshoptError(ValueError):
    """Invalid input for the codec, or a corrupt stream."""


def block_elements(stride: int) -> int:
    """Elements per attribute block for a byte stride (`maxBlockElements` in the spec)."""
    return min((8192 // stride) & ~15, 256)


def _zigzag(values: np.ndarray) -> np.ndarray:
    v = values.astype(np.uint8)
    return np.where(v & 0x80, ~(v << 1), v << 1).astype(np.uint8)


def _unzigzag(value: int) -> int:
    return (~(value >> 1) & 0xFF) if value & 1 else value >> 1


def _encode_planes(zz: np.ndarray) -> np.ndarray:
    """Encode byte planes `(planes, groups, 16)` of zigzag deltas, each plane with its own
    header bytes, in plane order. Returns the concatenated bytes."""
    planes, groups, _ = zz.shape
    count3 = (zz >= 3).sum(axis=2)
    count15 = (zz >= 15).sum(axis=2)
    zero = ~zz.any(axis=2)
    sizes = np.stack(
        [
            np.where(zero, 0, 1 << 30),
            4 + count3,
            8 + count15,
            np.full_like(count3, 16),
        ],
        axis=-1,
    )
    # Prefer the cheapest mode; on ties keep raw bytes, like the reference encoder.
    order = np.array([3, 0, 1, 2])
    mode = order[np.argmin(sizes[..., order], axis=-1)]
    size = np.take_along_axis(sizes, mode[..., None], axis=-1)[..., 0]

    header_size = (groups + 3) // 4
    padded = np.zeros((planes, header_size * 4), dtype=np.uint8)
    padded[:, :groups] = mode
    quads = padded.reshape(planes, header_size, 4)
    headers = (quads[..., 0] | quads[..., 1] << 2 | quads[..., 2] << 4 | quads[..., 3] << 6).astype(
        np.uint8
    )

    plane_size = header_size + size.sum(axis=1)
    plane_start = np.concatenate([[0], np.cumsum(plane_size)[:-1]])
    group_start = plane_start[:, None] + header_size + np.cumsum(size, axis=1) - size
    out = np.zeros(int(plane_size.sum()), dtype=np.uint8)
    out[plane_start[:, None] + np.arange(header_size)] = headers

    raw = mode == 3
    if raw.any():
        out[group_start[raw][:, None] + np.arange(GROUP)] = zz[raw]
    for bits, packed_size, limit in ((2, 4, 3), (4, 8, 15)):
        selected = mode == (1 if bits == 2 else 2)
        if not selected.any():
            continue
        values = zz[selected]
        codes = np.minimum(values, limit).astype(np.uint8)
        per_byte = 8 // bits
        shaped = codes.reshape(len(codes), packed_size, per_byte)
        shifts = np.arange(per_byte - 1, -1, -1, dtype=np.uint8) * bits
        packed = np.bitwise_or.reduce(shaped << shifts, axis=2).astype(np.uint8)
        starts = group_start[selected]
        out[starts[:, None] + np.arange(packed_size)] = packed
        escape = values >= limit
        rank = np.cumsum(escape, axis=1) - 1
        positions = starts[:, None] + packed_size + rank
        out[positions[escape]] = values[escape]
    return out


def encode_attributes(data: np.ndarray | bytes, stride: int) -> bytes:
    """Compress `count * stride` bytes of tightly packed elements (`ATTRIBUTES` mode)."""
    if stride <= 0 or stride % 4 or stride > MAX_STRIDE:
        raise MeshoptError(f"byte stride {stride} must be a multiple of 4 up to {MAX_STRIDE}")
    raw = np.frombuffer(bytes(data), dtype=np.uint8) if isinstance(data, bytes) else data
    raw = np.ascontiguousarray(raw).view(np.uint8).reshape(-1)
    if raw.size % stride:
        raise MeshoptError(f"{raw.size} bytes are not a whole number of {stride}-byte elements")
    elements = raw.reshape(-1, stride)
    count = len(elements)
    if count == 0:
        raise MeshoptError("nothing to encode")
    baseline = elements[0]
    previous = np.concatenate([baseline[None], elements[:-1]])
    zz = _zigzag(elements - previous)  # uint8 wrap-around deltas

    per_block = block_elements(stride)
    chunks = [np.array([HEADER], dtype=np.uint8)]
    full = count // per_block
    if full:
        blocks = zz[: full * per_block].reshape(full, per_block // GROUP, GROUP, stride)
        planes = blocks.transpose(0, 3, 1, 2).reshape(full * stride, per_block // GROUP, GROUP)
        chunks.append(_encode_planes(planes))
    rest = count - full * per_block
    if rest:
        groups = -(-rest // GROUP)
        tail = np.zeros((groups * GROUP, stride), dtype=np.uint8)
        tail[:rest] = zz[full * per_block :]
        planes = tail.reshape(groups, GROUP, stride).transpose(2, 0, 1)
        chunks.append(_encode_planes(np.ascontiguousarray(planes)))
    padding = max(TAIL - stride, 0)
    chunks.append(np.zeros(padding, dtype=np.uint8))
    chunks.append(baseline.copy())
    return np.concatenate(chunks).tobytes()


def _decode_group(stream: bytes, offset: int, mode: int) -> tuple[list[int], int]:
    if mode == 0:
        return [0] * GROUP, offset
    if mode == 3:
        return list(stream[offset : offset + GROUP]), offset + GROUP
    bits = 2 if mode == 1 else 4
    packed_size = 4 if bits == 2 else 8
    limit = (1 << bits) - 1
    per_byte = 8 // bits
    extra = offset + packed_size
    values = []
    for index in range(GROUP):
        byte = stream[offset + index // per_byte]
        shift = (per_byte - 1 - index % per_byte) * bits
        code = (byte >> shift) & limit
        if code == limit:
            code = stream[extra]
            extra += 1
        values.append(code)
    return values, extra


def decode_attributes(stream: bytes, count: int, stride: int) -> bytes:
    """Reference decoder; inverse of `encode_attributes`."""
    if not stream or stream[0] != HEADER:
        raise MeshoptError("not a version 0 attribute stream")
    tail = max(TAIL, stride)
    if len(stream) < 1 + tail:
        raise MeshoptError("stream too short")
    previous = list(stream[len(stream) - stride :])
    out = bytearray(count * stride)
    offset = 1
    per_block = block_elements(stride)
    done = 0
    while done < count:
        size = min(per_block, count - done)
        groups = -(-size // GROUP)
        header_size = (groups + 3) // 4
        for k in range(stride):
            header = stream[offset : offset + header_size]
            offset += header_size
            deltas: list[int] = []
            for group in range(groups):
                mode = (header[group // 4] >> ((group % 4) * 2)) & 3
                values, offset = _decode_group(stream, offset, mode)
                deltas.extend(values)
            value = previous[k]
            for i in range(size):
                value = (value + _unzigzag(deltas[i])) & 0xFF
                out[(done + i) * stride + k] = value
            previous[k] = value
        done += size
    if len(stream) - offset != tail:
        raise MeshoptError(f"{len(stream) - offset} bytes left for a {tail}-byte tail")
    return bytes(out)
